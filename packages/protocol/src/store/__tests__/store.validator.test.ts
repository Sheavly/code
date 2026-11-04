import { describe, expect, it } from 'vitest';
import { storedConversationSchema } from '../store.validator.js';

const stored = {
  id: 'c1',
  title: 'Chat',
  model: 'claude',
  status: 'interrupted',
  startedAt: 1,
  updatedAt: 2,
};

describe('storedConversationSchema', () => {
  it('reads what the index holds', () => {
    expect(storedConversationSchema.parse(stored)).toEqual(stored);
  });

  it('refuses a status no conversation has, and a missing field', () => {
    expect(storedConversationSchema.safeParse({ ...stored, status: 'running' }).success).toBe(
      false,
    );
    expect(storedConversationSchema.safeParse({ ...stored, title: undefined }).success).toBe(false);
  });
});
