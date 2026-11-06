import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FailureLog } from '../failure-log.service.js';
import { FAILURE_HEAD_LINES, FAILURE_TAIL_LINES } from '../failures.constants.js';
import { collapsedFailure, failuresText } from '../failures-text.utils.js';

/** Two failures: a command with three lines, and a one-line message that was too long. */
function twoFailures(): FailureLog {
  const log = new FailureLog();

  log.keep({
    title: 'Run the tests  $ npm test',
    content: 'FAIL a.test.ts\n  expected 1\n  got 2',
  });
  log.keep({ title: 'Read b.ts', content: 'b'.repeat(150) });

  return log;
}

const show = (target?: string, log = twoFailures()): string =>
  stripVTControlCharacters(failuresText({ failures: log.failures, target }));

describe('collapsedFailure', () => {
  it('is one line with how much more there is and the command that shows it', () => {
    const [first, second] = twoFailures().failures;

    expect(first && stripVTControlCharacters(collapsedFailure({ failure: first }))).toBe(
      '    ▸ 2 more lines · /errors 1\n',
    );
    expect(second && stripVTControlCharacters(collapsedFailure({ failure: second }))).toBe(
      '    ▸ full message · /errors 2\n',
    );
  });

  it('says "line" for one more line', () => {
    const failure = new FailureLog().keep({ title: 'x', content: 'a\nb' });

    expect(failure && stripVTControlCharacters(collapsedFailure({ failure }))).toContain(
      '1 more line ·',
    );
  });
});

describe('failuresText', () => {
  it('says there is nothing when no step failed with more to say', () => {
    expect(show(undefined, new FailureLog())).toBe(
      'No failed steps with more to say in this chat yet.',
    );
  });

  it('lists each failure with its step and first line', () => {
    expect(show()).toBe(
      [
        'Failed steps in this chat: 2',
        '  #1  Run the tests  $ npm test: FAIL a.test.ts',
        `  #2  Read b.ts: ${'b'.repeat(100)}…`,
        '/errors #<n> shows one in full.',
      ].join('\n'),
    );
  });

  it('shows one failure whole, by its number with or without the #', () => {
    const expected = [
      '▾ Run the tests  $ npm test · #1',
      '    FAIL a.test.ts',
      '      expected 1',
      '      got 2',
    ].join('\n');

    expect(show('1')).toBe(expected);
    expect(show('#1')).toBe(expected);
  });

  it('cuts a very long message to its start and its end, and counts what it left out', () => {
    const log = new FailureLog();
    const lines = Array.from({ length: 300 }, (_, index) => `line ${index + 1}`);

    log.keep({ title: 'Build', content: lines.join('\n') });

    const shown = show('1', log).split('\n');
    const hidden = 300 - FAILURE_HEAD_LINES - FAILURE_TAIL_LINES;

    expect(shown).toHaveLength(1 + FAILURE_HEAD_LINES + 1 + FAILURE_TAIL_LINES);
    expect(shown).toContain('    line 1');
    expect(shown).toContain(`    line ${FAILURE_HEAD_LINES}`);
    expect(shown).toContain(`    … ${hidden} lines not shown …`);
    expect(shown).not.toContain(`    line ${FAILURE_HEAD_LINES + 1}`);
    expect(shown.at(-1)).toBe('    line 300');
  });

  it('says what to type for a number that is not a failure and a target that is not a number', () => {
    expect(show('9')).toBe('No failure #9; /errors lists them.');
    expect(show('a.ts')).toBe('a.ts is not a failure; /errors lists them.');
  });
});
