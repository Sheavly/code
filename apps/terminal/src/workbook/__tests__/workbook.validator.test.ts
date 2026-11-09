import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { STATE_VERSION } from '../workbook.constants.js';
import { parsePromptFile, runResultSchema, stateSchema } from '../workbook.validator.js';

const NOV_2_NOON = DateTime.utc(2026, 11, 2, 12).toMillis();

describe('parsePromptFile', () => {
  it('reads front matter and the prompt text', () => {
    expect(
      parsePromptFile({ name: 'x', source: '---\nworkspace: basic\nmaxTurns: 7\n---\nDo it.\n' }),
    ).toEqual({ name: 'x', text: 'Do it.', workspace: 'basic', maxTurns: 7 });
  });

  it('reads the context window a prompt’s runs are told, and refuses one that is not a size', () => {
    expect(
      parsePromptFile({ name: 'x', source: '---\ncontextWindow: 40000\n---\nDo it.\n' }),
    ).toMatchObject({ contextWindow: 40_000 });
    expect(() =>
      parsePromptFile({ name: 'bad', source: '---\ncontextWindow: 0\n---\nHi\n' }),
    ).toThrow('Prompt "bad" is invalid');
    expect(() =>
      parsePromptFile({ name: 'big', source: '---\ncontextWindow: 99999999999\n---\nHi\n' }),
    ).toThrow('Prompt "big" is invalid');
  });

  it('treats a file without front matter as just the prompt', () => {
    expect(parsePromptFile({ name: 'x', source: 'Just this.\n' })).toEqual({
      name: 'x',
      text: 'Just this.',
    });
  });

  it('rejects an empty prompt or bad settings, naming the prompt', () => {
    expect(() =>
      parsePromptFile({ name: 'empty', source: '---\nworkspace: basic\n---\n' }),
    ).toThrow('Prompt "empty" is invalid');
    expect(() => parsePromptFile({ name: 'bad', source: '---\nmaxTurns: 0\n---\nHi\n' })).toThrow(
      'Prompt "bad" is invalid',
    );
  });
});

describe('parsePromptFile with a check', () => {
  it('reads a JSON value that goes on over indented lines', () => {
    const prompt = parsePromptFile({
      name: 'p',
      source:
        '---\nworkspace: basic\ncheck: {\n    "areas": ["src/x"],\n    "expect": { "reply": ["ok"] }\n  }\n---\n\nSay ok.\n',
    });

    expect(prompt).toMatchObject({
      workspace: 'basic',
      text: 'Say ok.',
      check: { areas: ['src/x'], expect: { reply: ['ok'] } },
    });
  });

  it('names the prompt and the key when the JSON is broken', () => {
    expect(() =>
      parsePromptFile({ name: 'broken', source: '---\ncheck: { "areas": [\n---\n\nHi\n' }),
    ).toThrow(/Prompt "broken" is invalid:\ncheck:/);
  });
});

describe('stateSchema', () => {
  it('accepts the workbook state', () => {
    const state = { version: STATE_VERSION, runCount: 2, lastRunByPrompt: { a: '0002-a' } };

    expect(stateSchema.parse(state)).toEqual(state);
  });

  it('rejects another version and a negative or fractional run count', () => {
    const state = { version: STATE_VERSION, runCount: 0, lastRunByPrompt: {} };

    expect(stateSchema.safeParse({ ...state, version: -1 }).success).toBe(false);
    expect(stateSchema.safeParse({ ...state, runCount: -1 }).success).toBe(false);
    expect(stateSchema.safeParse({ ...state, runCount: 1.5 }).success).toBe(false);
  });
});

describe('runResultSchema', () => {
  it('rejects an outcome a run cannot have', () => {
    const result = {
      outcome: 'completed',
      endedAt: NOV_2_NOON,
      durationMs: 1,
      events: 1,
      modelCalls: 1,
      toolCalls: 0,
      toolErrors: 0,
      sessions: 1,
      messages: 2,
    };

    expect(runResultSchema.safeParse(result).success).toBe(true);
    expect(runResultSchema.safeParse({ ...result, outcome: 'crashed' }).success).toBe(false);
    expect(runResultSchema.safeParse({ ...result, events: '1' }).success).toBe(false);
  });

  it('takes a time as milliseconds only: an ISO string, text or a fraction is not one', () => {
    const result = {
      outcome: 'completed',
      durationMs: 1,
      events: 1,
      modelCalls: 1,
      toolCalls: 0,
      toolErrors: 0,
      sessions: 1,
      messages: 2,
    };

    expect(runResultSchema.safeParse({ ...result, endedAt: NOV_2_NOON }).success).toBe(true);

    for (const endedAt of ['2026-11-02T12:00:00.000Z', 'soon', 1.5, -1]) {
      expect(runResultSchema.safeParse({ ...result, endedAt }).success).toBe(false);
    }
  });
});
