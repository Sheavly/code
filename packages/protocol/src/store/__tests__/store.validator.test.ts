import { describe, expect, it } from 'vitest';
import { storedConversationSchema } from '../store.validator.js';

const stored = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Chat',
  modelId: '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30',
  workspace: '/work/repo',
  profile: '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71',
  effort: 'medium',
  status: 'interrupted',
  startedAt: 1,
  updatedAt: 2,
};

describe('storedConversationSchema', () => {
  it('reads what the index holds', () => {
    expect(storedConversationSchema.parse(stored)).toEqual(stored);
  });

  it('holds the model by id, and always has one: a conversation is always on a model', () => {
    expect(storedConversationSchema.safeParse({ ...stored, modelId: 'claude' }).success).toBe(
      false,
    );
    expect(storedConversationSchema.safeParse({ ...stored, modelId: undefined }).success).toBe(
      false,
    );

    const { modelId: _modelId, ...unmodelled } = stored;

    expect(storedConversationSchema.safeParse(unmodelled).success).toBe(false);
  });

  it('refuses a status no conversation has, and a missing field', () => {
    expect(storedConversationSchema.safeParse({ ...stored, status: 'running' }).success).toBe(
      false,
    );
    expect(storedConversationSchema.safeParse({ ...stored, title: undefined }).success).toBe(false);
  });

  it('always has an effort, one of the known ones', () => {
    const { effort: _effort, ...unefforted } = stored;

    expect(storedConversationSchema.safeParse(unefforted).success).toBe(false);
    expect(storedConversationSchema.safeParse({ ...stored, effort: 'turbo' }).success).toBe(false);
  });

  it('always knows where it belongs: its workspace, and its profile by id', () => {
    for (const lacking of ['workspace', 'profile'] as const) {
      expect(storedConversationSchema.safeParse({ ...stored, [lacking]: undefined }).success).toBe(
        false,
      );
    }

    // A profile is named by its id, never by its label.
    expect(storedConversationSchema.safeParse({ ...stored, profile: 'Work' }).success).toBe(false);
  });
});
