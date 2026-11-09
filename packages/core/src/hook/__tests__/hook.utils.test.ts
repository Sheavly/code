import { describe, expect, it } from 'vitest';
import { DefinitionError } from '../../errors/definition.errors.js';
import { defineHook, hasHandler } from '../hook.utils.js';

describe('hasHandler', () => {
  it('counts beforeModelCall as a handler', () => {
    expect(hasHandler({ name: 'trim', beforeModelCall: async ({ messages }) => messages })).toBe(
      true,
    );
  });

  it('is false for a hook with only a name', () => {
    expect(hasHandler({ name: 'idle' })).toBe(false);
  });
});

describe('defineHook', () => {
  it('returns a beforeModelCall hook as it is', () => {
    const hook = { name: 'trim', beforeModelCall: async () => [] };

    expect(defineHook(hook)).toBe(hook);
  });

  it('rejects a hook that handles nothing', () => {
    expect(() => defineHook({ name: 'idle' })).toThrow(DefinitionError);
  });
});
