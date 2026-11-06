import { describe, expect, it } from 'vitest';
import { FailureLog } from '../failure-log.service.js';

const title = 'Run the tests  $ npm test';

describe('FailureLog', () => {
  it('numbers failures from 1 with the first line, the whole message and the lines after it', () => {
    const log = new FailureLog();

    expect(log.keep({ title, content: 'FAIL a.test.ts\n  expected 1\n  got 2\n' })).toEqual({
      number: 1,
      title,
      summary: 'FAIL a.test.ts',
      content: 'FAIL a.test.ts\n  expected 1\n  got 2',
      moreLines: 2,
    });
    expect(log.keep({ title, content: 'one\ntwo' })?.number).toBe(2);
    expect(log.failures.map(({ number }) => number)).toEqual([1, 2]);
  });

  it('keeps nothing for a one-line message that the step showed whole', () => {
    const log = new FailureLog();

    expect(log.keep({ title, content: 'File not found: a.ts' })).toBeUndefined();
    expect(log.keep({ title, content: '\n\nno such file\n\n' })).toBeUndefined();
    expect(log.keep({ title, content: '' })).toBeUndefined();
    expect(log.failures).toEqual([]);
  });

  it('keeps a one-line message the step had to cut, with no more lines to count', () => {
    const log = new FailureLog();
    const long = `error: ${'x'.repeat(200)}`;

    expect(log.keep({ title, content: long })).toMatchObject({
      number: 1,
      moreLines: 0,
      content: long,
    });
  });

  it('does not count blank lines, and drops escape codes from what it keeps', () => {
    const log = new FailureLog();
    const failure = log.keep({ title, content: '\u001b[31mFAIL\u001b[0m\n\n\nboom\n' });

    expect(failure).toMatchObject({ summary: 'FAIL', content: 'FAIL\n\n\nboom', moreLines: 1 });
  });
});
