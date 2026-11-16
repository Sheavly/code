import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { ENTRY_EVENT } from '@sheavly/protocol/api/api.constants';

/** Test-only: a stream entry (a task starting) at `seq`, as the backend sends it. */
export function taskEntry(seq: number) {
  return {
    seq,
    at: 1_700_000_000_000,
    sessionId: 'main',
    kind: 'task',
    update: {
      type: 'task_started',
      task: {
        id: 't1',
        command: 'npm test',
        description: 'Tests',
        kind: 'task',
        status: 'running',
        startedAt: 1,
        output: '',
      },
    },
  };
}

/** Test-only: one entry as the backend's SSE frame. */
function entryFrame(entry: { seq: number } | StreamEntry): string {
  return `event: ${ENTRY_EVENT}\nid: ${String(entry.seq)}\ndata: ${JSON.stringify(entry)}\n\n`;
}

/**
 * Test-only: a response body that sends `entries` as SSE frames, after a head frame when `head` is
 * given (the `seq` of the last entry made before the stream opened), then ends cleanly or, with
 * `dropWith`, fails like a dropped connection. The failure comes on a later read, since erroring
 * a stream drops what is queued and unread.
 */
export function sseBody(params: {
  entries: readonly ({ seq: number } | StreamEntry)[];
  head?: number;
  dropWith?: Error;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = false;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;

        if (params.head !== undefined) {
          controller.enqueue(encoder.encode(`id: ${String(params.head)}\n\n`));
        }

        for (const entry of params.entries) controller.enqueue(encoder.encode(entryFrame(entry)));

        return;
      }

      if (params.dropWith) controller.error(params.dropWith);
      else controller.close();
    },
  });
}
