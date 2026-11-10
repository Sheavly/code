import type { ApprovalUpdate } from '@sheavly/protocol/approval/approval.types';
import type { SessionId, SessionInfo } from '@sheavly/protocol/session/session.types';

/** A sub-agent's session as the stream last showed it: its title, depth and parent. */
export type AgentSession = Extract<SessionInfo, { parentId: SessionId }>;

/** One approval update, with the session it is about and, for a sub-agent, who that is. */
export type HeardApproval = {
  update: ApprovalUpdate;
  /** The session whose tool asked: the stream entry's, so it is set even when `agent` is not. */
  sessionId: SessionId;
  /**
   * The sub-agent that asked, when the stream has shown it start. Unset for the main session; a
   * UI decides whether and how to render it, and can always fall back to `sessionId`.
   */
  agent?: AgentSession;
};
