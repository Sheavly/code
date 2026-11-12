import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { SessionInfo } from '@sheavly/protocol/session/session.types';
import { MAX_SCAN_ENTRIES, MAX_SEARCH_LIMIT } from './history.constants.js';
import type { HistoryCursor, HistoryToolOptions, SearchHit, SearchPage } from './history.types.js';
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

/**
 * One session's entries from `from` to `to` (inclusive, to the end when absent) searched for
 * `query`: at most `room` matches, and at most `budget` entries examined. `last` is the `seq` of
 * the last entry examined, and `stopped` says why it ended early (`limit` or `budget`) or that it
 * reached the end of the span.
 */
async function searchSession(params: {
  options: HistoryToolOptions;
  info: SessionInfo;
  span: { from: number; to: number | undefined };
  query: string;
  room: number;
  budget: number;
  signal: AbortSignal;
}): Promise<{
  hits: SearchHit[];
  scanned: number;
  last: number | undefined;
  stopped: 'limit' | 'budget' | 'end';
}> {
  const { options, info, span, query, room, budget, signal } = params;
  const log = options.logOf({ session: info.id, main: !('parentId' in info) });
  const wanted = query.toLowerCase();
  const hits: SearchHit[] = [];
  let scanned = 0;
  let last: number | undefined;

  for await (const record of log.read(span.from)) {
    signal.throwIfAborted();

    if (span.to !== undefined && record.seq > span.to) break;

    scanned += 1;
    last = record.seq;

    const text = entryText(record.entry);

    if (text.toLowerCase().includes(wanted)) {
      hits.push({
        session: info.id,
        seq: record.seq,
        role: record.entry.role,
        excerpt: excerptAround({ text, query }),
      });
    }

    if (hits.length === room) return { hits, scanned, last, stopped: 'limit' };
    if (scanned === budget) return { hits, scanned, last, stopped: 'budget' };
  }

  return { hits, scanned, last, stopped: 'end' };
}

/**
 * Looks for `query` (ignoring case) in the original entries of the conversation's sessions, the
 * main one first and then its sub-agents in the order they started, `limit` results at a time and
 * examining at most `MAX_SCAN_ENTRIES` entries a call. `from` and `to` narrow it to a span of
 * entries of one `session`. `cursor` resumes just after the last entry an earlier call examined,
 * inside the same span. `next` is set when the call stopped early (enough matches, or the scan
 * budget), and may lead to an empty page when nothing more matches. Throws a `ToolCallError` for
 * a `session` or a `cursor` that names no session of this conversation, or a span without a
 * session or with `from` after `to`.
 */
export async function searchHistory(params: {
  options: HistoryToolOptions;
  query: string;
  session?: SessionId | undefined;
  span?: { from?: number | undefined; to?: number | undefined };
  limit: number;
  cursor?: HistoryCursor | undefined;
  signal: AbortSignal;
}): Promise<SearchPage> {
  const { options, query, session, cursor, signal } = params;
  const { from = 0, to } = params.span ?? {};

  assertValidSpan({ session, from, to });

  const limit = Math.min(params.limit, MAX_SEARCH_LIMIT);
  const hits: SearchHit[] = [];
  let scanned = 0;

  for (const info of sessionsToSearch({ options, session, cursor })) {
    // Only the cursor's own session resumes mid-way; every later one is read from its start.
    const resumeAt = info.id === cursor?.session ? cursor.seq + 1 : 0;
    const page = await searchSession({
      options,
      info,
      span: { from: Math.max(from, resumeAt), to },
      query,
      room: limit - hits.length,
      budget: MAX_SCAN_ENTRIES - scanned,
      signal,
    });

    hits.push(...page.hits);
    scanned += page.scanned;

    if (page.stopped !== 'end' && page.last !== undefined) {
      return { hits, scanned, next: { session: info.id, seq: page.last } };
    }
  }

  return { hits, scanned };
}

/** A span names entries of one session, so it needs one, and cannot end before it begins. */
function assertValidSpan(params: {
  session: SessionId | undefined;
  from: number;
  to: number | undefined;
}): void {
  const { session, from, to } = params;

  if ((from > 0 || to !== undefined) && session === undefined) {
    throw new ToolCallError({
      reason: 'invalid_input',
      message:
        'A span (from, to) names entries of one session, so give its session too: entry numbers mean nothing across sessions',
    });
  }

  if (to !== undefined && from > to) {
    throw new ToolCallError({
      reason: 'invalid_input',
      message: `The span starts at entry ${String(from)} but ends at ${String(to)}`,
    });
  }
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
