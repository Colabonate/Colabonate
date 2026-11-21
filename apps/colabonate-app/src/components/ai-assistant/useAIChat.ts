import { useState, useCallback, useRef, useEffect } from 'react';
import type { MessageTurn, SSEEvent, ChatSession, AiProviderId, AiProviderInfo, EntityPayload } from './ai-assistant.types';
import { announceAiCredits } from './useAiCredits';
import {
  saveSession as persistSession,
  loadSession as readSession,
  listSessions as readAllSessions,
  deleteSession as removeSession,
  renameSession as updateSessionTitle,
  getActiveSessionId,
  setActiveSessionId,
  createNewSession,
} from './ChatSessionManager';

const MCP_SERVER_URL = '/ai/chat';

export interface OllamaParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_ctx?: number;
  repeat_penalty?: number;
  seed?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// F6: the assistant is told NOT to repeat entity data in prose, so IDs never
// reach the history and a follow-up like "publish the second one" would force a
// fresh search or an invented ID. A compact digest is appended to assistant
// history turns (never shown in the UI) so IDs stay available across turns.
const MAX_DIGEST_ENTRIES = 10;

function entityDigest(entities: EntityPayload[]): string {
  const lines: string[] = [];
  const push = (line: string) => {
    if (lines.length < MAX_DIGEST_ENTRIES) lines.push(line);
  };

  for (const entity of entities) {
    const e = entity as {
      kind: string;
      items?: unknown[];
      entityType?: string;
      entity?: { id?: string; title?: string; name?: string; status?: string };
      id?: string;
    };

    if (Array.isArray(e.items)) {
      const noun = e.kind.replace(/s$/, '');
      for (const item of e.items) {
        if (lines.length >= MAX_DIGEST_ENTRIES) break;
        if (!item || typeof item !== 'object') continue;
        const it = item as { id?: string; title?: string; name?: string; status?: string };
        const label = it.title ?? it.name;
        if (!it.id && !label) continue;
        push(`${noun} id=${it.id ?? '?'}${label ? ` "${label}"` : ''}${it.status ? ` status=${it.status}` : ''}`);
      }
    } else if (e.kind === 'created' || e.kind === 'updated') {
      const it = e.entity;
      const label = it?.title ?? it?.name;
      push(`${e.entityType ?? 'item'} id=${it?.id ?? '?'}${label ? ` "${label}"` : ''}${it?.status ? ` status=${it.status}` : ''}`);
    } else if (e.kind === 'deleted') {
      push(`deleted id=${e.id ?? '?'}`);
    }
  }

  return lines.length > 0 ? `\n[results: ${lines.join('; ')}]` : '';
}

// F15: raw provider/tool errors ("Error: 500", "Tool error: Error: …",
// "Connection error: TypeError…") are not useful to a user. Map the common
// cases to short, actionable sentences; everything else keeps a compact form.
function friendlyErrorMessage(event: { message?: string; code?: string }): string {
  const raw = event.message ?? '';
  if (event.code === 'AI_CREDITS_EXHAUSTED') {
    return `${raw}. Buy a credit pack in Settings → AI, or add your own provider key.`;
  }
  if (event.code === 'AI_CONTEXT_TOO_LARGE') return raw;
  if (/401|403|unauthor|invalid or expired token/i.test(raw)) {
    return 'Your session expired. Please sign in again.';
  }
  if (/context length|too many tokens|too large/i.test(raw)) {
    return 'This request is too large for the model. Start a new chat or shorten your message.';
  }
  if (/\b(500|502|503|504)\b|upstream|temporarily unavailable|ECONN|fetch failed/i.test(raw)) {
    return 'The AI service is temporarily unavailable. Please try again.';
  }
  if (/tool error|tool .* failed/i.test(raw)) {
    return 'A tool could not complete that request. Please try again.';
  }
  return raw ? `Something went wrong: ${raw}` : 'Something went wrong. Please try again.';
}

function getStoredSettings() {
  const model = localStorage.getItem('aiModel') || import.meta.env.VITE_OLLAMA_DEFAULT_MODEL || 'qwen2.5:7b-instruct-q4_K_M';
  const ollama: OllamaParams = {};
  
  const temp = localStorage.getItem('aiTemperature') || import.meta.env.VITE_OLLAMA_TEMPERATURE;
  if (temp) ollama.temperature = parseFloat(temp);
  
  const topP = localStorage.getItem('aiTopP') || import.meta.env.VITE_OLLAMA_TOP_P;
  if (topP) ollama.top_p = parseFloat(topP);
  
  const topK = localStorage.getItem('aiTopK') || import.meta.env.VITE_OLLAMA_TOP_K;
  if (topK) ollama.top_k = parseInt(topK, 10);
  
  const numCtx = localStorage.getItem('aiNumCtx') || import.meta.env.VITE_OLLAMA_NUM_CTX;
  if (numCtx) ollama.num_ctx = parseInt(numCtx, 10);
  
  const repeatPenalty = localStorage.getItem('aiRepeatPenalty') || import.meta.env.VITE_OLLAMA_REPEAT_PENALTY;
  if (repeatPenalty) ollama.repeat_penalty = parseFloat(repeatPenalty);
  
  const seed = localStorage.getItem('aiSeed') || import.meta.env.VITE_OLLAMA_SEED;
  if (seed) ollama.seed = parseInt(seed, 10);
  
  const freqPenalty = localStorage.getItem('aiFrequencyPenalty') || import.meta.env.VITE_OLLAMA_FREQUENCY_PENALTY;
  if (freqPenalty) ollama.frequency_penalty = parseFloat(freqPenalty);
  
  const presPenalty = localStorage.getItem('aiPresencePenalty') || import.meta.env.VITE_OLLAMA_PRESENCE_PENALTY;
  if (presPenalty) ollama.presence_penalty = parseFloat(presPenalty);

  return { model, ollama };
}

export function useAIChat() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => getActiveSessionId());
  const [sessions, setSessions] = useState<ChatSession[]>(() => readAllSessions());
  const [providerInfo, setProviderInfo] = useState<AiProviderInfo | null>(null);
  const [turns, setTurns] = useState<MessageTurn[]>(() => {
    const activeId = getActiveSessionId();
    if (activeId) {
      const session = readSession(activeId);
      return session?.turns ?? [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  // F7/F21: surfaces need to know whether this is the anonymous guest path (no
  // token, session credits) to pick the right quick actions and placeholder.
  const [isGuest] = useState(() => !localStorage.getItem('authToken'));
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshSessions = useCallback(() => {
    setSessions(readAllSessions());
  }, []);

  useEffect(() => {
    if (!currentSessionId || turns.length === 0) return;
    const session = readSession(currentSessionId);
    if (session) {
      persistSession({ ...session, turns });
    }
  }, [turns, currentSessionId]);

  // F15: map raw provider/tool errors to short, actionable sentences.
  const runTurn = useCallback(async (message: string, images: string[] | undefined, baseTurns: MessageTurn[]) => {
    if (isLoading) return;

    const token = localStorage.getItem('authToken');
    // ADR-384 D10: a visitor without an account can still chat once they bought
    // session credits (opaque id, this browser only).
    const guestSessionId = !token ? localStorage.getItem('aiGuestSessionId') : null;
    if (!token && !guestSessionId) {
      const errorTurn: MessageTurn = {
        id: generateId(),
        role: 'assistant',
        text: 'Please log in — or buy session credits on the home page — to use the AI assistant.',
        toolActivity: null,
        entities: [],
        status: 'error',
      };
      setTurns(prev => [...prev, errorTurn]);
      return;
    }

    let sessionId = currentSessionId;
    if (!sessionId) {
      const session = createNewSession(message);
      sessionId = session.id;
      setCurrentSessionId(sessionId);
      setSessions(readAllSessions());
    }

    abortControllerRef.current = new AbortController();
    setIsLoading(true);

    const userTurn: MessageTurn = {
      id: generateId(),
      role: 'user',
      text: message,
      images: images && images.length > 0 ? images : undefined,
      toolActivity: null,
      entities: [],
      status: 'done',
    };

    const assistantTurnId = generateId();

    const assistantTurn: MessageTurn = {
      id: assistantTurnId,
      role: 'assistant',
      text: '',
      toolActivity: null,
      steps: [],
      entities: [],
      status: 'streaming',
    };
    // F16: regenerate/retry replaces the turn it repeats instead of appending a duplicate.
    setTurns(() => [...baseTurns, userTurn, assistantTurn]);

    try {
      // ADR-389: never resend attached images from past turns. Each turn's
      // images are base64 data URLs; repeating them every request ballooned the
      // payload until it exceeded the model context. Tools only ever use the
      // images attached to the current message (sent separately as `images`).
      // F6: assistant turns carry a compact entity digest so IDs survive turns.
      const history = baseTurns
        .filter(t => t.status === 'done')
        .map(t => ({
          role: t.role as 'user' | 'assistant',
          content: t.role === 'assistant' ? `${t.text}${entityDigest(t.entities)}` : t.text,
        }));

      const { model, ollama } = getStoredSettings();
      const provider: AiProviderId = guestSessionId
        ? 'platform'
        : ((localStorage.getItem('aiProvider') as AiProviderId | null) ?? 'openai');
      const customInstructions = localStorage.getItem('aiSystemPrompt')?.trim() || undefined;

      const response = await fetch(MCP_SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, token: token ?? undefined, guestSessionId: guestSessionId ?? undefined, history, model, ollama, images, provider, customInstructions }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        setTurns(prev => prev.map(t =>
          t.id === assistantTurnId ? { ...t, text: `Error: ${response.status}`, status: 'error' as const } : t
        ));
        setIsLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setTurns(prev => prev.map(t =>
          t.id === assistantTurnId ? { ...t, text: 'No stream available', status: 'error' as const } : t
        ));
        setIsLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const event = JSON.parse(data) as SSEEvent;

            if (event.type === 'provider-info') {
              setProviderInfo(event.info);
              // Hosted mode reports the live balance on every turn: keep every surface in sync.
              if (typeof event.info.requestsRemaining === 'number') announceAiCredits(event.info.requestsRemaining);
            }

            setTurns(prev => {
              const next = prev.map(t => {
                if (t.id !== assistantTurnId) return t;

                switch (event.type) {
                  case 'provider-info':
                    return t;
                  case 'text-delta':
                    return { ...t, text: t.text + event.delta };
                  case 'tool-start':
                    return { ...t, toolActivity: { tool: event.tool, label: event.label } };
                  case 'tool-result': {
                    const payload = event.payload as { items?: unknown[] };
                    const count = Array.isArray(payload.items) ? payload.items.length : undefined;
                    const label = (t.toolActivity?.label ?? 'Done').replace(/…$/, '');
                    return {
                      ...t,
                      entities: [...t.entities, event.payload],
                      toolActivity: null,
                      steps: [...(t.steps ?? []), { tool: t.toolActivity?.tool ?? 'tool', label, count }],
                    };
                  }
                  case 'done':
                    return { ...t, status: 'done' as const };
                  case 'error':
                    return {
                      ...t,
                      text: t.text + `\n${friendlyErrorMessage(event)}`,
                      status: 'error' as const,
                    };
                  default:
                    return t;
                }
              });

              return next;
            });
          } catch {
          }
        }
      }

      setTurns(prev => prev.map(t =>
        t.id === assistantTurnId && t.status === 'streaming' ? { ...t, status: 'done' as const } : t
      ));
    } catch (err) {
      // Fetch aborts surface as a DOMException with name 'AbortError' — which is
      // not an Error instance in the browser, so check the name directly.
      const aborted = (err as { name?: string } | null)?.name === 'AbortError';
      if (aborted) {
        setTurns(prev => prev.map(t =>
          t.id === assistantTurnId ? { ...t, status: 'cancelled' as const } : t
        ));
      } else {
        setTurns(prev => prev.map(t =>
          t.id === assistantTurnId ? { ...t, text: t.text + `\n${friendlyErrorMessage({ message: String(err) })}`, status: 'error' as const } : t
        ));
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, currentSessionId]);

  const submitMessage = useCallback((message: string, images?: string[]) => {
    void runTurn(message, images, turns);
  }, [runTurn, turns]);

  // F15/F16: re-run the last user message. Replaces the trailing user/assistant
  // turns instead of appending, so retry and regenerate do not duplicate history.
  const regenerate = useCallback(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === 'user') {
        void runTurn(turns[i].text, turns[i].images, turns.slice(0, i));
        return;
      }
    }
  }, [runTurn, turns]);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const clearHistory = useCallback(() => {
    setTurns([]);
    setCurrentSessionId(null);
    localStorage.removeItem('aiChatActiveSession');
  }, []);

  const newSession = useCallback(() => {
    setTurns([]);
    setCurrentSessionId(null);
    localStorage.removeItem('aiChatActiveSession');
  }, []);

  const loadSession = useCallback((id: string) => {
    const session = readSession(id);
    if (session) {
      setTurns(session.turns);
      setCurrentSessionId(id);
      setActiveSessionId(id);
    }
  }, []);

  const deleteSession = useCallback((id: string) => {
    removeSession(id);
    refreshSessions();
    if (currentSessionId === id) {
      setTurns([]);
      setCurrentSessionId(null);
    }
  }, [currentSessionId, refreshSessions]);

  const renameSession = useCallback((id: string, title: string) => {
    updateSessionTitle(id, title);
    refreshSessions();
  }, [refreshSessions]);

  return {
    turns,
    isLoading,
    isGuest,
    submitMessage,
    regenerate,
    cancel,
    clearHistory,
    currentSessionId,
    sessions,
    newSession,
    loadSession,
    deleteSession,
    renameSession,
    refreshSessions,
    providerInfo,
  };
}
