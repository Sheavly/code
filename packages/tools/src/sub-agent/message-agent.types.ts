import type {
  ChildSessionScope,
  SessionInfoView,
} from '@sheavly/runtime/sessions/session-scope.types';

/** The two things `message_agent` reads about a session before it sends. */
export type SessionLookup = Pick<SessionInfoView, 'get' | 'isReleased'>;

/**
 * What `message_agent` acts through: a `SessionInfoView` to look the target up and the
 * `ChildSessionScope` that sends to the children its extension owns.
 */
export type MessageAgentOptions = {
  sessions: SessionLookup;
  children: Pick<ChildSessionScope, 'send'>;
};

/**
 * What `report_status` acts through: the `ChildSessionScope` that reports for the children its
 * extension owns.
 */
export type ReportStatusOptions = { children: Pick<ChildSessionScope, 'report'> };
