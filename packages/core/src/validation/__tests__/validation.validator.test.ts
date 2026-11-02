import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseOrThrow, validate } from '../validation.validator.js';

const schema = z.object({ name: z.string(), port: z.number().int() });

describe('validate', () => {
  it('returns the typed data for valid input', () => {
    expect(validate({ schema, input: { name: 'a', port: 1 } })).toEqual({
      success: true,
      data: { name: 'a', port: 1 },
    });
  });

  it("rejects invalid input with zod's readable summary of every issue and the original error", () => {
    const result = validate({ schema, input: { name: 1, port: 1.5 } });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.details).toContain('name');
    expect(result.details).toContain('port');
    expect(result.error).toBeInstanceOf(z.ZodError);
  });
});

describe('parseOrThrow', () => {
  class ConfigError extends Error {}

  const onInvalid = ({ details, error }: { details: string; error: z.ZodError }) =>
    new ConfigError(`Invalid config:\n${details}`, { cause: error });

  it('returns the typed data for valid input', () => {
    expect(parseOrThrow({ schema, input: { name: 'a', port: 1 }, onInvalid })).toEqual({
      name: 'a',
      port: 1,
    });
  });

  it("throws the caller's error, with the summary in its message and zod's error as cause", () => {
    let thrown: unknown;

    try {
      parseOrThrow({ schema, input: { name: 'a' }, onInvalid });
    } catch (caughtError) {
      thrown = caughtError;
    }

    expect(thrown).toBeInstanceOf(ConfigError);
    expect((thrown as Error).message).toContain('port');
    expect((thrown as Error).cause).toBeInstanceOf(z.ZodError);
  });
});
