import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { LiveConversation } from '@sheavly/host/conversations/conversations.types';
import type { EntryFilter } from '@sheavly/runtime/sessions/sessions.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { ENTRY_EVENT, HEARTBEAT_MS } from './server.constants.js';
import { isAfter } from './server.utils.js';

/**
 * A conversation's combined stream as server-sent events: each entry `filter` picks, after
 * `lastEventId` when a client resumes, as one `entry` frame whose `id` is its `seq`. With
 * `answersApprovals`, the client counts as someone who can answer them while it is open, so a
 * request waits for its answer; a client that didn't say so never makes one wait. It ends when the
 * client leaves, or once `isLast` says an entry was the
 * stream's last (a prompt's response ends with its `done`). A heartbeat comment keeps a quiet
 * stream open through proxies. Disconnecting only ends this subscription: the prompt runs on.
 */
export function streamEntries(params: {
  c: Context;
  live: LiveConversation;
  filter: EntryFilter;
  lastEventId?: number | undefined;
  answersApprovals?: boolean;
  isLast?: (entry: StreamEntry) => boolean;
  /** Called once the subscription is set up, before any entry is sent (a prompt starts here). */
  onOpen?: () => void;
}) {
  const { c, live, filter, lastEventId, answersApprovals = false } = params;
  const { isLast = () => false, onOpen } = params;

  c.header('X-Accel-Buffering', 'no'); // a buffering proxy (nginx) would hold events back

  return streamSSE(c, async (stream) => {
    const queue: StreamEntry[] = [];
    let wake: (() => void) | undefined;
    let ended = false;
    const end = () => {
      ended = true;
      wake?.();
    };
    const unsubscribe = live.harness.sessions.subscribeEntries((entry) => {
      if (!isAfter({ entry, lastEventId })) return;
      queue.push(entry);
      wake?.();
    }, filter);
    // Listening makes an approval wait for an answer; the answer comes as its own request.
    const stopListening = answersApprovals
      ? live.harness.approvals.subscribe(() => undefined)
      : () => undefined;
    const heartbeat = setInterval(() => void stream.write(': heartbeat\n\n'), HEARTBEAT_MS);

    stream.onAbort(end);

    try {
      onOpen?.();

      while (!ended) {
        const entry = queue.shift();

        if (!entry) {
          await new Promise<void>((resolve) => (wake = resolve));
          continue;
        }

        await stream.writeSSE({
          event: ENTRY_EVENT,
          id: String(entry.seq),
          data: JSON.stringify(entry),
        });
        if (isLast(entry)) end();
      }
    } finally {
      clearInterval(heartbeat);
      stopListening();
      unsubscribe();
    }
  });
}
