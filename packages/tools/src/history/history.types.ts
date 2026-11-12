import type { HistoryLog } from '@sheavly/core/store/store.types';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';

/** What the app decides about the history tools: which sessions exist, and where their logs are. */
export type HistoryToolOptions = {
  /** The conversation's sessions: the main one and every sub-agent it started. */
  sessions: SessionRegistry;
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
  excerpt: string;
};

/** Where a search resumes: just after entry `seq` of `session`. */
export type HistoryCursor = { session: SessionId; seq: number };
