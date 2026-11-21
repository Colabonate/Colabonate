import type OpenAI from 'openai';

// ADR-389 — context-window budgeting for the AI Assistant.
//
// The hosted (`platform`) path used to cap only the OUTPUT tokens (ADR-384 D3),
// so a tool-heavy turn could grow the request past the provider's context window
// and fail with a raw 400 ("maximum context length is … tokens"). Search tools
// return unbounded marketplace payloads and attached images were echoed back as
// base64 text, so a single "longer request" reached ~1.7M tokens. These helpers
// trim the request to the model's input budget: oversized tool results are cut,
// the oldest conversation history is dropped, and the current user turn is never
// dropped — instead the caller reports a friendly "too large" error.
//
// Token counts are an estimate (chars / 4) on purpose: exact tokenisation is
// provider- and model-specific, and the estimate only needs to be conservative
// enough to stay safely under the window.

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

const CHARS_PER_TOKEN = 4;
// DeepSeek V4 Flash bills an image at up to 384 input tokens (see the Vision
// API guide); rounded up to stay conservative.
const IMAGE_PART_TOKENS = 512;
// Never trim tool output below this, even if the budget is tiny — a result
// shorter than this stops being useful to the model.
const MIN_TOOL_CHARS = 2000;

function contentTokens(content: unknown): number {
  if (typeof content === 'string') return Math.ceil(content.length / CHARS_PER_TOKEN);
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const typed = part as { type?: string; text?: string };
    if (typed.type === 'text' && typeof typed.text === 'string') {
      total += Math.ceil(typed.text.length / CHARS_PER_TOKEN);
    } else if (typed.type === 'image_url') {
      total += IMAGE_PART_TOKENS;
    }
  }
  return total;
}

export function estimateMessageTokens(message: ChatMessage): number {
  const typed = message as {
    content?: unknown;
    tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
  };
  let total = contentTokens(typed.content);
  if (Array.isArray(typed.tool_calls)) {
    for (const call of typed.tool_calls) {
      total += Math.ceil((call.function?.name?.length ?? 0) / CHARS_PER_TOKEN);
      total += Math.ceil((call.function?.arguments?.length ?? 0) / CHARS_PER_TOKEN);
    }
  }
  return total;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} characters to fit the model context]`;
}

/**
 * Caps every `tool` message so the combined tool output cannot exceed half the
 * input budget. Applied before history trimming so one oversized search payload
 * can never crowd out the conversation or the user's own message.
 */
export function capToolResults(messages: ChatMessage[], maxInputTokens: number): ChatMessage[] {
  const toolIndices: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === 'tool') toolIndices.push(index);
  });
  if (toolIndices.length === 0) return messages;

  const totalBudgetChars = Math.max(
    MIN_TOOL_CHARS * toolIndices.length,
    Math.floor(maxInputTokens * 0.5) * CHARS_PER_TOKEN,
  );
  const perToolChars = Math.max(MIN_TOOL_CHARS, Math.floor(totalBudgetChars / toolIndices.length));

  const capped = messages.slice();
  for (const index of toolIndices) {
    const message = capped[index] as { content?: unknown };
    if (typeof message.content === 'string' && message.content.length > perToolChars) {
      capped[index] = { ...(capped[index] as object), content: truncateText(message.content, perToolChars) } as ChatMessage;
    }
  }
  return capped;
}

export interface FitResult {
  /** The trimmed message list to send to the provider. */
  messages: ChatMessage[];
  /**
   * True when even the system prompt + current user turn exceed the budget,
   * i.e. trimming cannot make the request fit. The caller should surface a
   * friendly error instead of calling the provider.
   */
  overflow: boolean;
  /** How many older history messages were dropped (for logging/tests). */
  droppedHistory: number;
}

/**
 * Trims `messages` to `maxInputTokens`. The system prompt and the current turn
 * (the last user message plus any tool rounds after it) are always kept; older
 * history is dropped from the oldest end until the budget is met. Tool results
 * are capped first, so they cannot dominate the budget.
 */
export function fitMessagesToBudget(messages: ChatMessage[], maxInputTokens: number): FitResult {
  if (messages.length === 0) return { messages, overflow: false, droppedHistory: 0 };

  const capped = capToolResults(messages, maxInputTokens);

  const systemEnd = capped[0]?.role === 'system' ? 1 : 0;
  let turnStart = capped.length - 1;
  for (let i = capped.length - 1; i >= systemEnd; i--) {
    if (capped[i].role === 'user') {
      turnStart = i;
      break;
    }
  }

  const head = capped.slice(0, systemEnd);
  const history = capped.slice(systemEnd, turnStart);
  const tail = capped.slice(turnStart);

  const headTailTokens = estimateMessagesTokens([...head, ...tail]);
  if (headTailTokens > maxInputTokens) {
    return { messages: capped, overflow: true, droppedHistory: 0 };
  }

  let used = headTailTokens;
  const keptHistory: ChatMessage[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(history[i]);
    if (used + cost > maxInputTokens) break;
    keptHistory.unshift(history[i]);
    used += cost;
  }
  // The trimmed history must not start with a dangling assistant message (its
  // user turn was dropped), which some providers reject.
  while (keptHistory.length > 0 && keptHistory[0].role !== 'user') keptHistory.shift();

  return {
    messages: [...head, ...keptHistory, ...tail],
    overflow: false,
    droppedHistory: history.length - keptHistory.length,
  };
}
