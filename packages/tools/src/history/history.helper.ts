import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { SessionInfo } from '@sheavly/protocol/session/session.types';
import { MAX_SEARCH_LIMIT } from './history.constants.js';
import type { HistoryCursor, HistoryToolOptions, SearchHit } from './history.types.js';
import { entryText, excerptAround } from './history.utils.js';

/**
 * The sessions a search looks through, in order: `session` alone, or all of them, starting at the
 * cursor's session when resuming. A `session` or cursor that names none of them is refused.
 */
function sessionsToSearch(params: {
  options: HistoryToolOptions;
  session: SessionId | undefined;
  cursor: HistoryCursor | undefined;
}): SessionInfo[] {
  const { options, session, cursor } = params;
  const known = options.sessions.list();
  const wanted = session ? known.filter((each) => each.id === session) : known;

  if (session && wanted.length === 0) throw unknownSession(session);

  if (!cursor) return wanted;

  const at = wanted.findIndex((each) => each.id === cursor.session);

  if (at === -1) throw unknownSession(cursor.session);

  return wanted.slice(at);
}

/** Matches of `query` in one session's entries from `from` on, at most `room` of them. */
async function searchSession(params: {
  options: HistoryToolOptions;
  info: SessionInfo;
  from: number;
  query: string;
  room: number;
  signal: AbortSignal;
}): Promise<SearchHit[]> {
  const { options, info, from, query, room, signal } = params;
  const log = options.logOf({ session: info.id, main: !('parentId' in info) });
  const wanted = query.toLowerCase();
  const hits: SearchHit[] = [];

  for await (const record of log.read(from)) {
    signal.throwIfAborted();

    const text = entryText(record.entry);

    if (!text.toLowerCase().includes(wanted)) continue;

    hits.push({
      session: info.id,
      seq: record.seq,
      role: record.entry.role,
      excerpt: excerptAround({ text, query }),
    });

    if (hits.length === room) break;
  }

  return hits;
}

/**
 * Looks for `query` (ignoring case) in the original entries of the conversation's sessions, the
 * main one first and then its sub-agents in the order they started, `limit` results at a time.
 * `cursor` resumes just after a result of an earlier search. `next` is set when the limit was
 * reached, and may lead to an empty page when nothing more matches. Throws a `ToolCallError` for
 * a `session` or a `cursor` that names no session of this conversation.
 */
export async function searchHistory(params: {
  options: HistoryToolOptions;
  query: string;
  session?: SessionId | undefined;
  limit: number;
  cursor?: HistoryCursor | undefined;
  signal: AbortSignal;
}): Promise<{ hits: SearchHit[]; next?: HistoryCursor }> {
  const { options, query, session, cursor, signal } = params;
  const limit = Math.min(params.limit, MAX_SEARCH_LIMIT);
  const hits: SearchHit[] = [];

  for (const info of sessionsToSearch({ options, session, cursor })) {
    // Only the cursor's own session resumes mid-way; every later one is read from its start.
    const from = info.id === cursor?.session ? cursor.seq + 1 : 0;

    hits.push(
      ...(await searchSession({ options, info, from, query, room: limit - hits.length, signal })),
    );

    const last = hits.at(-1);

    if (last && hits.length === limit) {
      return { hits, next: { session: last.session, seq: last.seq } };
    }
  }

  return { hits };
}

/** Entry `seq` of `session`, exactly as stored; a `ToolCallError` when there is none. */
export async function readHistoryEntry(params: {
  options: HistoryToolOptions;
  session: SessionId;
  seq: number;
  signal: AbortSignal;
}): Promise<{ role: HistoryMessage['role']; text: string }> {
  const { options, session, seq, signal } = params;
  const info = options.sessions.get(session);

  if (!info) throw unknownSession(session);

  const log = options.logOf({ session, main: !('parentId' in info) });

  for await (const record of log.read(seq)) {
    signal.throwIfAborted();

    if (record.seq === seq) return { role: record.entry.role, text: entryText(record.entry) };

    break;
  }

  throw new ToolCallError({
    reason: 'not_found',
    message: `Session ${session} has no entry ${String(seq)}`,
  });
}

function unknownSession(session: SessionId): ToolCallError {
  return new ToolCallError({
    reason: 'not_found',
    message: `No session ${session} in this conversation`,
  });
}
