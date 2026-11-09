import { describe, expect, it } from 'vitest';
import { diagnosticRecord } from '../diagnostic-record.utils.js';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { callIdSchema, messageIdSchema } from '@sheavly/protocol/message/message.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';

const base = {
  seq: 2,
  at: 100,
  sessionId: sessionIdSchema.parse('main'),
  messageId: messageIdSchema.parse('00000000-0000-4000-8000-000000000001'),
};
const conversationId = conversationIdSchema.parse('00000000-0000-4000-8000-000000000002');

function recorded(entry: StreamEntry) {
  return diagnosticRecord({ entry, conversationId, modelId: undefined });
}

describe('diagnostic record projection', () => {
  it('records tool identity and failure text without copying arguments', () => {
    const call = {
      id: callIdSchema.parse('read-1'),
      name: 'read_file',
      input: { body: 'private request' },
    };
    const entry = {
      ...base,
      kind: 'event',
      event: {
        seq: 0,
        type: 'tool_result',
        call,
        description: 'Read',
        durationMs: 1,
        message: {
          role: 'tool',
          toolCallId: call.id,
          isError: true,
          content: 'password=private-secret',
        },
      },
    } satisfies StreamEntry;
    const record = recorded(entry);

    expect(record).toMatchObject({
      type: 'tool_failed',
      toolCallId: call.id,
      toolName: 'read_file',
      messageId: base.messageId,
    });
    expect(record?.error).toBe('password=[REDACTED]');
    expect(JSON.stringify(record)).not.toContain('private');
    expect(
      recorded({
        ...entry,
        event: { ...entry.event, message: { ...entry.event.message, isError: false } },
      }),
    ).toBeUndefined();
  });

  it('records hook identity but excludes ordinary transcript entries', () => {
    expect(
      recorded({
        ...base,
        kind: 'event',
        event: {
          seq: 0,
          type: 'hook_failed',
          hook: 'audit',
          handler: 'onError',
          error: 'Hook failed',
        },
      }),
    ).toMatchObject({
      type: 'hook_failed',
      hook: 'audit',
      handler: 'onError',
      error: 'Hook failed',
    });
    expect(
      recorded({
        ...base,
        kind: 'event',
        event: { seq: 0, type: 'text_delta', text: 'private prompt' },
      }),
    ).toBeUndefined();
  });
});
