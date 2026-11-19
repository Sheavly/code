import { describe, expect, it } from 'vitest';
import {
  storedConversationIndexSchema,
  storedProfileFileSchema,
} from '../legacy-effort.validator.js';

const MODEL = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';
const PROFILE = '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71';
const INDEX = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Chat',
  modelId: MODEL,
  workspace: '/work/repo',
  profile: PROFILE,
  status: 'closed',
  startedAt: 1,
  updatedAt: 2,
};

describe('a conversation index written before "mode" became "effort"', () => {
  it('reads its mode as the effort', () => {
    expect(storedConversationIndexSchema.parse({ ...INDEX, mode: 'high' })).toEqual({
      ...INDEX,
      effort: 'high',
    });
  });

  it('reads one in the current form as it is, and prefers the effort when both are there', () => {
    expect(storedConversationIndexSchema.parse({ ...INDEX, effort: 'low' })).toEqual({
      ...INDEX,
      effort: 'low',
    });
    expect(storedConversationIndexSchema.parse({ ...INDEX, mode: 'high', effort: 'low' })).toEqual({
      ...INDEX,
      effort: 'low',
    });
  });

  it('still refuses an index with no effort, and one with a value that is not an effort', () => {
    expect(storedConversationIndexSchema.safeParse(INDEX).success).toBe(false);
    expect(storedConversationIndexSchema.safeParse({ ...INDEX, mode: 'turbo' }).success).toBe(
      false,
    );
  });

  it('does not let a file with a __proto__ key change what every object inherits', () => {
    const hostile: unknown = JSON.parse(
      JSON.stringify({ ...INDEX, mode: 'low' }).replace('{', '{"__proto__":{"polluted":true},'),
    );
    const parsed = storedConversationIndexSchema.parse(hostile);

    expect(parsed).toEqual({ ...INDEX, effort: 'low' });
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    const fresh: { polluted?: boolean } = {};

    expect(fresh.polluted).toBeUndefined();
  });
});

describe('a profile written before "mode" became "effort"', () => {
  const profile = { id: PROFILE, name: 'Work' };

  it('reads the remembered selection and per-model modes as efforts', () => {
    expect(
      storedProfileFileSchema.parse({
        ...profile,
        lastModelSelection: { modelId: MODEL, mode: 'extreme' },
        modelModes: { [MODEL]: 'extreme' },
      }),
    ).toEqual({
      ...profile,
      lastModelSelection: { modelId: MODEL, effort: 'extreme' },
      modelEfforts: { [MODEL]: 'extreme' },
    });
  });

  it('reads a profile with no remembered model as it is, and one in the current form unchanged', () => {
    const current = {
      ...profile,
      lastModelSelection: { modelId: MODEL, effort: 'low' },
      modelEfforts: { [MODEL]: 'low' },
    };

    expect(storedProfileFileSchema.parse(profile)).toEqual(profile);
    expect(storedProfileFileSchema.parse(current)).toEqual(current);
  });

  it('prefers the new key when both are there, and still refuses a value that is not an effort', () => {
    expect(
      storedProfileFileSchema.parse({
        ...profile,
        modelModes: { [MODEL]: 'low' },
        modelEfforts: { [MODEL]: 'high' },
      }),
    ).toEqual({ ...profile, modelEfforts: { [MODEL]: 'high' } });
    expect(
      storedProfileFileSchema.safeParse({ ...profile, modelModes: { [MODEL]: 'turbo' } }).success,
    ).toBe(false);
  });
});
