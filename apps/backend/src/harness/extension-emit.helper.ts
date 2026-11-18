import type { ExtensionEmission } from '@sheavly/extension/emit/emit.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';

/**
 * Carries what an extension emitted, already checked by the extension host, to its session: the
 * one the extension named, or the conversation's main session. An event is published at once with
 * `seq: 0`, like `storage_failed`: it belongs to no run. A notice goes into the session's outbox,
 * which its loop drains at the next turn. Throws a `SessionError` for a session that is unknown,
 * released or (for a notice) ended, which the emitting extension sees.
 */
export function routeEmission(params: {
  sessions: SessionRegistry;
  main: SessionId;
  emission: ExtensionEmission;
}): void {
  const { sessions, main, emission } = params;
  const id = emission.session ?? main;

  if (emission.kind === 'notice') {
    sessions.queueNotice({ id, notice: emission.notice });

    return;
  }

  sessions.publish({ sessionId: id, event: { seq: 0, ...emission.event } });
}
