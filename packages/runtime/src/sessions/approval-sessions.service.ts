import type { ApprovalId, ApprovalUpdate } from '@sheavly/protocol/approval/approval.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';

/** Keeps approval answers under the session that requested them, even after other sessions start. */
export class ApprovalSessions {
  readonly #sessions = new Map<ApprovalId, SessionId>();

  keepSession(params: { update: ApprovalUpdate; main: () => SessionId }): SessionId {
    const { update, main } = params;

    if (update.type === 'approval_requested') {
      const id = update.request.sessionId ?? main();

      this.#sessions.set(update.request.id, id);

      return id;
    }

    const id = this.#sessions.get(update.id) ?? main();

    this.#sessions.delete(update.id);

    return id;
  }
}
