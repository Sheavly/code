import { describe, expect, it } from 'vitest';
import { contextNotice, contextState } from '../context.utils.js';

const tokens = {
  inputTokens: 40_000,
  outputTokens: 8_210,
  cacheReadTokens: 30_000,
  cacheWriteTokens: 0,
};

describe('contextState', () => {
  it('counts what the last call used as its input plus its output, cached input included once', () => {
    expect(contextState({ window: 400_000, lastTokens: tokens })).toEqual({
      window: 400_000,
      used: 48_210,
    });
  });

  it('leaves out what is not known', () => {
    expect(contextState({ window: undefined, lastTokens: undefined })).toEqual({
      window: undefined,
      used: undefined,
    });
  });
});

describe('contextNotice', () => {
  it('says how much of the window the last call used', () => {
    expect(contextNotice({ window: 400_000, used: 48_210 })).toBe(
      'Context: 48,210 of 400,000 tokens used (12%)',
    );
  });

  it('shows only the window before any call has reported usage', () => {
    expect(contextNotice({ window: 300_000 })).toBe('Context: 300,000 token window');
  });

  it('shows only what was used when the window is unknown', () => {
    expect(contextNotice({ used: 1_500 })).toBe('Context: 1,500 tokens used');
  });

  it('says nothing when nothing is known', () => {
    expect(contextNotice({})).toBeUndefined();
  });

  it('keeps counting past a full window instead of hiding it', () => {
    expect(contextNotice({ window: 1_000, used: 1_250 })).toBe(
      'Context: 1,250 of 1,000 tokens used (125%)',
    );
  });
});
