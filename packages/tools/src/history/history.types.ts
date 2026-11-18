import type { HistoryLog } from '@sheavly/core/store/store.types';
import type { SessionInfoView } from '@sheavly/runtime/sessions/session-scope.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';

/** What the app decides about the history tools: which sessions exist, and where their logs are. */
export type HistoryToolOptions = {
  /**
   * The conversation's sessions, read as metadata only: the main one and every sub-agent it
   * started, whoever started them.
   */
  sessions: Pick<SessionInfoView, 'get' | 'list' | 'isReleased' | 'releasedStarts'>;
  /**
   * The durable log of `session`. `main` is true for the conversation's main session, whose log
   * is the conversation's own rather than a sub-agent's.
   */
  logOf: (params: { session: SessionId; main: boolean }) => HistoryLog;
};

/** One match of a search: where the entry is, what it is, and some context around the match. */
export type SearchHit = {
  session: SessionId;
  seq: number;
  role: HistoryMessage['role'];
  /** Where the first match starts in the entry's text, to read around it with `offset`. */
  at: number;
  excerpt: string;
};

/**
 * What one search call found: the matches, how many entries it examined, and `next` when it
 * stopped before the end (it had enough matches, or reached its scan budget): where to resume.
 */
export type SearchPage = { hits: SearchHit[]; scanned: number; next?: HistoryCursor };

/** What a search was limited to: one session, and a span of its entries. All absent: everything. */
export type SearchScope = {
  session?: SessionId | undefined;
  from?: number | undefined;
  to?: number | undefined;
};

/**
 * Where a search resumes: just after entry `seq` of `session`, inside the `scope` the search
 * began with. The scope travels with the cursor so a continued search cannot widen or move it.
 */
export type HistoryCursor = { session: SessionId; seq: number; scope: SearchScope };
