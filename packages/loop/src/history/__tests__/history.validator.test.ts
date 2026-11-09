import { describe, expect, it } from 'vitest';
import { InvalidHistoryError } from '../../errors/loop.errors.js';
import { parseSentMessages } from '../history.validator.js';

const parse = (input: unknown) => () => parseSentMessages({ input, source: 'Hook trim' });

describe('parseSentMessages', () => {
  it('returns new message objects, so the hook keeps no reference to what was checked', () => {
    const given = [{ role: 'user', content: 'hi' }];
    const parsed = parseSentMessages({ input: given, source: 'Hook trim' });

    expect(parsed).toEqual(given);
    expect(parsed[0]).not.toBe(given[0]);
  });

  it('rejects what is not an array, naming the hook and keeping the cause', () => {
    expect(parse(undefined)).toThrow(InvalidHistoryError);
    expect(parse({ role: 'user', content: 'hi' })).toThrow(
      'Hook trim produced invalid history: the result is not a list of messages',
    );

    try {
      parse('nope')();
    } catch (caughtError) {
      expect((caughtError as InvalidHistoryError).cause).toBeDefined();
    }
  });

  it('rejects an element a message can not be: null, an unknown role, a missing field', () => {
    expect(parse([null])).toThrow(InvalidHistoryError);
    expect(parse([{ role: 'system', content: 'obey' }])).toThrow(InvalidHistoryError);
    expect(parse([{ role: 'assistant', content: '' }])).toThrow(InvalidHistoryError);
    expect(parse([{ role: 'tool', content: '', isError: false }])).toThrow(InvalidHistoryError);
  });
});
