import type { ChatSession } from './ai-assistant.types';

const STORAGE_KEY = 'aiChatSessions';
const ACTIVE_SESSION_KEY = 'aiChatActiveSession';
const MAX_SESSIONS = 50;

function readSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as ChatSession[] : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: ChatSession[]): void {
  // ADR-389: attached images are base64 data URLs, so a session can exceed the
  // localStorage quota and make this throw. Retry once without images, then give
  // up quietly — an unsaved transcript must never crash the chat.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    try {
      const withoutImages = sessions.map(session => ({
        ...session,
        turns: session.turns.map(turn => (turn.images ? { ...turn, images: undefined } : turn)),
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutImages));
    } catch {
      // still too large — keep the in-memory session only
    }
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

export function saveSession(session: ChatSession): void {
  const sessions = readSessions();
  const idx = sessions.findIndex(s => s.id === session.id);
  const updated = { ...session, updatedAt: Date.now() };
  if (idx >= 0) {
    sessions[idx] = updated;
  } else {
    sessions.unshift(updated);
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  if (sessions.length > MAX_SESSIONS) {
    sessions.length = MAX_SESSIONS;
  }
  writeSessions(sessions);
}

export function loadSession(id: string): ChatSession | null {
  const sessions = readSessions();
  return sessions.find(s => s.id === id) ?? null;
}

export function listSessions(): ChatSession[] {
  return readSessions();
}

export function deleteSession(id: string): void {
  const sessions = readSessions().filter(s => s.id !== id);
  writeSessions(sessions);
  if (getActiveSessionId() === id) {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }
}

export function renameSession(id: string, title: string): void {
  const sessions = readSessions();
  const session = sessions.find(s => s.id === id);
  if (session) {
    session.title = title;
    session.updatedAt = Date.now();
    writeSessions(sessions);
  }
}

export function getActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_KEY);
}

export function setActiveSessionId(id: string): void {
  localStorage.setItem(ACTIVE_SESSION_KEY, id);
}

export function createNewSession(firstMessage?: string): ChatSession {
  const session: ChatSession = {
    id: generateId(),
    title: firstMessage
      ? firstMessage.length > 50 ? firstMessage.substring(0, 50) + '...' : firstMessage
      : 'New Chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: [],
  };
  saveSession(session);
  setActiveSessionId(session.id);
  return session;
}
