import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

/** Test-only: what the loop sends after a turn's starts, naming the calls whose results follow. */
export function batchOf(...calls: EntryEvent[]): EntryEvent {
  return {
    seq: 1,
    type: 'tool_batch',
    calls: calls.flatMap((event) =>
      event.type === 'tool_call_started'
        ? [{ call: event.call, description: event.description }]
        : [],
    ),
  };
}

/** Test-only: the start and the successful result of one `run_command` step `id`. */
export function step(id: string, description: string): [EntryEvent, EntryEvent] {
  const call = { id: callIdSchema.parse(id), name: 'run_command', input: { command: id } };

  return [
    { seq: 0, type: 'tool_call_started', call, description },
    {
      seq: 2,
      type: 'tool_result',
      call,
      description,
      message: { role: 'tool', toolCallId: call.id, content: 'ok', isError: false },
      durationMs: 300,
    },
  ];
}
