import { describe, expect, it } from 'vitest';
import { checkSchema, runSourcesSchema } from '../check.validator.js';

describe('checkSchema', () => {
  it('accepts forbidden failed-output patterns and rejects empty ones', () => {
    expect(
      checkSchema.safeParse({
        areas: ['src/x'],
        forbid: { toolErrors: { read_file: ['Reading .env files is not allowed'] } },
      }).success,
    ).toBe(true);
    expect(
      checkSchema.safeParse({ areas: ['src/x'], forbid: { toolErrors: { read_file: [''] } } })
        .success,
    ).toBe(false);
  });

  it('accepts tool result assertions and rejects empty patterns', () => {
    expect(
      checkSchema.safeParse({
        areas: ['src/x'],
        expect: { toolResults: { run_command: ['CHECK_OK'] } },
      }).success,
    ).toBe(true);
    expect(
      checkSchema.safeParse({ areas: ['src/x'], expect: { toolResults: { run_command: [''] } } })
        .success,
    ).toBe(false);
  });

  it('accepts hook-specific context assertions and rejects empty hook names', () => {
    expect(
      checkSchema.safeParse({
        areas: ['src/x'],
        expect: { contextHooks: ['house-rules'] },
        forbid: { contextHooks: ['untrusted'] },
      }).success,
    ).toBe(true);
    expect(
      checkSchema.safeParse({ areas: ['src/x'], forbid: { contextHooks: [''] } }).success,
    ).toBe(false);
  });

  it('rejects a check with no expectations, or with steps and top-level ones at once', () => {
    expect(checkSchema.safeParse({ areas: ['src/x'] }).success).toBe(false);
    expect(
      checkSchema.safeParse({
        areas: ['src/x'],
        expect: { reply: ['x'] },
        steps: [{ run: {} }],
      }).success,
    ).toBe(false);
    expect(checkSchema.safeParse({ areas: ['src/x'], typo: true, expect: {} }).success).toBe(false);
  });
});

describe('runSourcesSchema', () => {
  it('accepts the list of run sources', () => {
    const sources = { include: ['src/'], exclude: ['__tests__/'] };

    expect(runSourcesSchema.parse(sources)).toEqual(sources);
  });

  it('rejects an empty include list and empty patterns', () => {
    expect(runSourcesSchema.safeParse({ include: [], exclude: [] }).success).toBe(false);
    expect(runSourcesSchema.safeParse({ include: [''], exclude: [] }).success).toBe(false);
    expect(runSourcesSchema.safeParse({ include: ['src/'] }).success).toBe(false);
  });
});
