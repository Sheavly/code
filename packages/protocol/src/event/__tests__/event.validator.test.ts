import { describe, expect, it } from 'vitest';
import { agentEventSchema } from '../event.validator.js';

const CALL = {
  call: { id: 'call-1', name: 'read_file', input: { path: 'a.ts' } },
  description: 'reading a.ts',
};
const SESSION = { id: 'main', rootId: 'main', depth: 1 };

describe('agentEventSchema', () => {
  it('accepts every event kind with its seq', () => {
    const bodies = [
      { type: 'text_delta', text: 'hi' },
      { type: 'reasoning', item: { source: 'openai:gpt', data: { encrypted: 'x' } } },
      { type: 'tool_call_started', ...CALL },
      { type: 'turn_end', turn: 1, stopReason: 'interrupted' },
      { type: 'tool_batch', calls: [CALL] },
      {
        type: 'tool_result',
        ...CALL,
        message: { role: 'tool', toolCallId: 'call-1', content: 'ok', isError: false },
        durationMs: 3,
      },
      { type: 'context_added', hook: 'agents-md', content: 'rules' },
      { type: 'model_input_changed', hook: 'trim', turn: 2, added: 0, removed: 3, edited: 1 },
      { type: 'hook_failed', hook: 'h', handler: 'onError', error: 'boom' },
      { type: 'message_received', message: { from: 'user', content: 'stop', sentAt: 1 } },
      {
        type: 'done',
        reason: 'completed',
        messages: [{ role: 'user', content: 'go' }],
        session: SESSION,
      },
    ];

    bodies.forEach((body, seq) => {
      expect(agentEventSchema.parse({ seq, ...body })).toEqual({ seq, ...body });
    });
  });

  it('keeps the fields of a tool artifact it does not know', () => {
    const artifact = { kind: 'table', rows: [[1, 2]] };
    const event = agentEventSchema.parse({
      seq: 0,
      type: 'tool_result',
      ...CALL,
      message: { role: 'tool', toolCallId: 'call-1', content: 'ok', isError: false },
      durationMs: 1,
      artifacts: [artifact],
    });

    expect(event).toMatchObject({ artifacts: [artifact] });
  });

  it('rejects an event without seq, with a negative seq, or of an unknown kind', () => {
    expect(agentEventSchema.safeParse({ type: 'text_delta', text: 'hi' }).success).toBe(false);
    expect(agentEventSchema.safeParse({ seq: -1, type: 'text_delta', text: 'hi' }).success).toBe(
      false,
    );
    expect(agentEventSchema.safeParse({ seq: 0, type: 'shout', text: 'hi' }).success).toBe(false);
  });

  it('rejects a model_input_changed with a negative or missing count', () => {
    const event = { seq: 0, type: 'model_input_changed', hook: 'trim', turn: 1 };

    const counts = { added: 0, removed: 1, edited: 0 };

    expect(agentEventSchema.safeParse({ ...event, ...counts }).success).toBe(true);
    expect(agentEventSchema.safeParse({ ...event, ...counts, added: -1 }).success).toBe(false);
    expect(agentEventSchema.safeParse({ ...event, added: 0, removed: 1 }).success).toBe(false);
    expect(agentEventSchema.safeParse({ ...event, added: 0 }).success).toBe(false);
  });

  it('rejects an artifact without a kind and a message with an unknown role', () => {
    const result = {
      seq: 0,
      type: 'tool_result',
      ...CALL,
      message: { role: 'tool', toolCallId: 'call-1', content: 'ok', isError: false },
      durationMs: 1,
    };

    expect(agentEventSchema.safeParse({ ...result, artifacts: [{ rows: [] }] }).success).toBe(
      false,
    );
    expect(
      agentEventSchema.safeParse({ ...result, message: { role: 'system', content: 'x' } }).success,
    ).toBe(false);
  });
});
