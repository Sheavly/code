import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { SessionId } from '@sheavly/protocol/session/session.types';

/**
 * Records where the prompt about to be sent begins in the combined stream: the `seq` of the main
 * session's last `session_resumed`, which `send` publishes once the prompt is prepared and
 * starting. Other entries made while skills are prepared (a background task ending, an approval, an
 * earlier run's tail) are not this prompt's, so they never count. `seq()` is undefined for the
 * conversation's first prompt, which has no resume: its entries all come after the stream opens.
 * Call `stop` when `send` has returned.
 */
export function recordPromptStart(params: { sessions: SessionRegistry; mainId: SessionId }): {
  seq: () => number | undefined;
  stop: () => void;
} {
  const { sessions, mainId } = params;
  let first: number | undefined;
  const stop = sessions.subscribeEntries((entry) => {
    if (entry.sessionId !== mainId) return;
    if (entry.kind === 'update' && entry.update.type === 'session_resumed') first = entry.seq;
  });

  return { seq: () => first, stop };
}
