import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import { capToolResults, estimateMessagesTokens, fitMessagesToBudget } from './context-budget.js';

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

const system = (text: string): ChatMessage => ({ role: 'system', content: text });
const user = (text: string): ChatMessage => ({ role: 'user', content: text });
const assistant = (text: string): ChatMessage => ({ role: 'assistant', content: text });
const tool = (id: string, text: string): ChatMessage => ({ role: 'tool', tool_call_id: id, content: text });

describe('estimateMessagesTokens', () => {
  it('estimates four characters per token', () => {
    expect(estimateMessagesTokens([user('12345678')])).toBe(2);
  });

  it('counts image parts at a fixed cost instead of their base64 length', () => {
    const withImage: ChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(400_000)}` } },
      ],
    };
    // 1 text token + 512 image tokens, nowhere near the raw 100k-char cost.
    expect(estimateMessagesTokens([withImage])).toBeLessThan(600);
  });
});

describe('capToolResults', () => {
  it('truncates a single oversized tool result to the shared budget', () => {
    const huge = tool('t1', 'x'.repeat(2_000_000));
    const [capped] = capToolResults([huge], 32_000);
    const content = (capped as { content: string }).content;
    expect(content.length).toBeLessThan(2_000_000);
    expect(content).toContain('[truncated');
  });

  it('leaves small tool results untouched', () => {
    const small = tool('t1', '{"offers":[]}');
    expect(capToolResults([small], 32_000)).toEqual([small]);
  });
});

describe('fitMessagesToBudget', () => {
  it('keeps the system prompt and current turn, dropping the oldest history first', () => {
    const messages = [
      system('s'),
      user('oldest'),
      assistant('oldest answer'),
      user('recent'),
      assistant('recent answer'),
      user('current question'),
    ];
    // Budget fits the system + current turn + only the most recent history pair.
    const budget = estimateMessagesTokens([system('s'), user('recent'), assistant('recent answer'), user('current question')]);
    const result = fitMessagesToBudget(messages, budget);
    expect(result.overflow).toBe(false);
    expect(result.droppedHistory).toBe(2);
    expect(result.messages.map(m => (m as { content: string }).content)).toEqual([
      's',
      'recent',
      'recent answer',
      'current question',
    ]);
  });

  it('keeps the tool rounds that belong to the current turn', () => {
    const messages = [
      system('s'),
      user('find offers'),
      assistant('searching'),
      tool('t1', '{"offers":[]}'),
    ];
    const result = fitMessagesToBudget(messages, 32_000);
    expect(result.messages).toHaveLength(4);
    expect(result.messages[3].role).toBe('tool');
  });

  it('never opens the trimmed history with a dangling assistant message', () => {
    const messages = [
      system('s'),
      user('oldest'),
      assistant('a1'),
      user('recent'),
      assistant('a2'),
      user('current question'),
    ];
    // Tiny budget fits only the newest history message (an assistant turn),
    // which must then be dropped rather than sent without its user turn.
    const result = fitMessagesToBudget(messages, 6);
    expect(result.messages.map(m => m.role)).toEqual(['system', 'user']);
  });

  it('reports overflow when the current user turn alone exceeds the budget', () => {
    const messages = [system('s'), user('x'.repeat(40_000))];
    const result = fitMessagesToBudget(messages, 1_000);
    expect(result.overflow).toBe(true);
  });

  it('returns messages untouched when they already fit', () => {
    const messages = [system('s'), user('hi')];
    expect(fitMessagesToBudget(messages, 32_000).messages).toEqual(messages);
  });
});
