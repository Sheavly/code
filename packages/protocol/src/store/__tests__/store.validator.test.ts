import { describe, expect, it } from 'vitest';
import { storedConversationSchema } from '../store.validator.js';

const stored = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Chat',
  modelId: '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30',
  status: 'interrupted',
  startedAt: 1,
  updatedAt: 2,
};

describe('storedConversationSchema', () => {
  it('reads what the index holds', () => {
    expect(storedConversationSchema.parse(stored)).toEqual(stored);
  });

  it('holds the model by id: a name is no model, and a conversation may have none', () => {
    expect(storedConversationSchema.safeParse({ ...stored, modelId: 'claude' }).success).toBe(
      false,
    );
    expect(storedConversationSchema.safeParse({ ...stored, modelId: undefined }).success).toBe(
      false,
    );

    const { modelId: _modelId, ...unmodelled } = stored;

    expect(storedConversationSchema.parse(unmodelled)).toEqual(unmodelled);
  });

  it('refuses a status no conversation has, and a missing field', () => {
    expect(storedConversationSchema.safeParse({ ...stored, status: 'running' }).success).toBe(
      false,
    );
    expect(storedConversationSchema.safeParse({ ...stored, title: undefined }).success).toBe(false);
  });
});
