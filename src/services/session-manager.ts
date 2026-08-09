/**
 * Server-side conversation session tracking for the hybrid send strategy.
 *
 * Two layers are tracked:
 * - `sessions`: maps a client-provided session key (OpenAI `user` field or
 *   `x-qwen-session` header) to a pinned Qwen chat_id + account + the last
 *   assistant response id. When complete, later turns can run in "economical"
 *   mode (send only system + last user message) because Qwen keeps the full
 *   conversation history server-side for that chat_id.
 * - `chatParents`: maps a chat_id to its last assistant response id so a new
 *   user message can be threaded with `parent_id` even without a session key.
 *
 * Sessions are persisted in SQLite so they survive a proxy restart; on recovery
 * the pinned chat (and therefore the server-side history) is re-used directly.
 */

import { config } from '../core/config.js';
import {
  listSessions,
  deleteSession,
} from '../core/database.js';
import { getDatabase } from '../core/database.js';

export interface SessionEntry {
  chatId: string;
  accountId: string;
  headers: Record<string, string>;
  parentId: string | null;
  historyComplete: boolean;
  updatedAt: number;
  /** Last time the server-side history was checked (in-memory, not persisted). */
  lastVerifiedAt?: number;
}

const MAX_SESSIONS = 2000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const sessions = new Map<string, SessionEntry>();
const chatToSession = new Map<string, string>();
const chatParents = new Map<string, { parentId: string | null; updatedAt: number }>();

let sessionsLoaded = false;
let lastCleanup = Date.now();

export function sessionTtlMs(): number {
  return config.hybridSessions.ttlMs || 24 * 60 * 60 * 1000;
}

function loadSessionsFromDb(): void {
  if (sessionsLoaded) return;
  sessionsLoaded = true;
  try {
    const rows = listSessions();
    const now = Date.now();
    for (const row of rows) {
      if (now - row.updated_at > sessionTtlMs()) {
        deleteSession(row.session_key);
        continue;
      }
      let headers: Record<string, string> = {};
      try {
        headers = JSON.parse(row.headers || '{}');
      } catch { /* keep empty */ }
      const entry: SessionEntry = {
        chatId: row.chat_id,
        accountId: row.account_id,
        headers,
        parentId: row.parent_id,
        historyComplete: row.history_complete !== 0,
        updatedAt: row.updated_at,
      };
      sessions.set(row.session_key, entry);
      chatToSession.set(row.chat_id, row.session_key);
      chatParents.set(row.chat_id, { parentId: row.parent_id, updatedAt: row.updated_at });
    }
    if (rows.length > 0) {
      console.log(`[Session] Restored ${rows.length} session(s) from SQLite`);
    }
  } catch (err: any) {
    console.warn(`[Session] Failed to restore sessions from SQLite:`, err.message);
  }
}

// --- Debounced SQLite writes -------------------------------------------------
// Session updates happen on the hot path (every response.created / economical
// turn). Instead of committing to SQLite synchronously each time, dirty entries
// are batched in memory and flushed in a single transaction every FLUSH_MS (or
// when the batch grows large). The in-memory maps remain the authoritative
// source between flushes, so correctness is unaffected.

const SESSION_FLUSH_MS = 500;
const SESSION_FLUSH_BATCH = 500;

let pendingSessions = new Map<string, SessionEntry>();
let flushTimer: NodeJS.Timeout | null = null;

function flushPendingSessionWrites(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingSessions.size === 0) return;
  const batch = pendingSessions;
  pendingSessions = new Map();
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO sessions (session_key, chat_id, account_id, headers, parent_id, history_complete, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        chat_id = excluded.chat_id,
        account_id = excluded.account_id,
        headers = excluded.headers,
        parent_id = excluded.parent_id,
        history_complete = excluded.history_complete,
        updated_at = excluded.updated_at
    `);
    const tx = db.transaction((rows: Array<{ session_key: string; chat_id: string; account_id: string; headers: string; parent_id: string | null; history_complete: number; updated_at: number }>) => {
      for (const row of rows) stmt.run(row.session_key, row.chat_id, row.account_id, row.headers, row.parent_id, row.history_complete, row.updated_at);
    });
    tx([...batch.entries()].map(([session_key, e]) => ({
      session_key,
      chat_id: e.chatId,
      account_id: e.accountId,
      headers: JSON.stringify(e.headers || {}),
      parent_id: e.parentId,
      history_complete: e.historyComplete ? 1 : 0,
      updated_at: e.updatedAt,
    })));
  } catch (err: any) {
    // Keep the in-memory state (authoritative) and drop the failed batch
    // rather than blocking the request path with back-off writes.
    console.warn(`[Session] Failed to flush ${batch.size} session write(s) to SQLite:`, err.message);
  }
}

function queueSessionWrite(sessionKey: string, entry: SessionEntry): void {
  pendingSessions.set(sessionKey, entry);
  if (pendingSessions.size >= SESSION_FLUSH_BATCH) {
    flushPendingSessionWrites();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(flushPendingSessionWrites, SESSION_FLUSH_MS);
    flushTimer.unref?.();
  }
}

/** Flush any pending session writes immediately (used on shutdown). */
export function flushSessions(): void {
  flushPendingSessionWrites();
}

function cleanupSessions(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS && sessions.size <= MAX_SESSIONS) return;
  lastCleanup = now;

  for (const [key, entry] of sessions.entries()) {
    if (now - entry.updatedAt > sessionTtlMs()) {
      sessions.delete(key);
      chatToSession.delete(entry.chatId);
      pendingSessions.delete(key);
      try { deleteSession(key); } catch { /* ignore */ }
    }
  }
  for (const [chatId, entry] of chatParents.entries()) {
    if (now - entry.updatedAt > sessionTtlMs()) {
      chatParents.delete(chatId);
    }
  }
}

export function getSession(sessionKey?: string | null): SessionEntry | undefined {
  if (!sessionKey) return undefined;
  loadSessionsFromDb();
  cleanupSessions();
  return sessions.get(sessionKey);
}

export function setSession(sessionKey: string, entry: SessionEntry): void {
  loadSessionsFromDb();
  cleanupSessions();
  const now = Date.now();
  const stored = { ...entry, updatedAt: now };
  chatToSession.delete(entry.chatId);
  sessions.set(sessionKey, stored);
  chatToSession.set(entry.chatId, sessionKey);
  chatParents.set(entry.chatId, { parentId: entry.parentId, updatedAt: now });
  queueSessionWrite(sessionKey, stored);
}

export function removeSession(sessionKey: string): void {
  loadSessionsFromDb();
  const entry = sessions.get(sessionKey);
  if (entry) {
    chatToSession.delete(entry.chatId);
    chatParents.delete(entry.chatId);
  }
  sessions.delete(sessionKey);
  pendingSessions.delete(sessionKey);
  try { deleteSession(sessionKey); } catch { /* ignore */ }
}

export function getSessionKeyByChatId(chatId: string): string | undefined {
  loadSessionsFromDb();
  return chatToSession.get(chatId);
}

/**
 * Resolves a client-provided session key to the canonical registry key. A
 * client may echo back the chat_id returned by the proxy; map it back to the
 * original session key so economical mode can continue.
 */
export function resolveSessionKey(sessionKey: string): string | undefined {
  loadSessionsFromDb();
  if (sessions.has(sessionKey)) return sessionKey;
  const byChat = chatToSession.get(sessionKey);
  return byChat ?? undefined;
}

/**
 * Records the last assistant response id for a chat_id and, when that chat is
 * pinned to a session, marks the session history as complete so future turns
 * can use economical mode.
 */
export function updateSessionParent(chatId: string, parentId: string | null): void {
  loadSessionsFromDb();
  const now = Date.now();
  chatParents.set(chatId, { parentId, updatedAt: now });
  const sessionKey = chatToSession.get(chatId);
  if (sessionKey) {
    const session = sessions.get(sessionKey);
    if (session) {
      session.parentId = parentId;
      session.historyComplete = true;
      session.updatedAt = now;
      queueSessionWrite(sessionKey, session);
    }
  }
}

export function getSessionParent(chatId: string): string | null {
  loadSessionsFromDb();
  return chatParents.get(chatId)?.parentId ?? null;
}

export function getSessionCount(): number {
  loadSessionsFromDb();
  cleanupSessions();
  return sessions.size;
}

/** Clears all in-memory and persisted sessions (test/ops helper). */
export function resetAllSessions(): void {
  sessions.clear();
  chatToSession.clear();
  chatParents.clear();
  pendingSessions.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  sessionsLoaded = true;
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM sessions').run();
  } catch { /* ignore */ }
}