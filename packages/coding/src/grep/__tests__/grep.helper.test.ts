import { describe, expect, it } from 'vitest';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { MAX_GREP_RAW_CHARS } from '../grep.constants.js';
import { assertRanToTheEnd, runRipgrep } from '../grep.helper.js';
import type { RipgrepRun } from '../grep.types.js';

describe('runRipgrep output cap', () => {
  // A real process that prints three times the cap stands in for ripgrep: the helper only
  // cares that the output stops being collected and the process stops being run.
  it('stops collecting at the cap, marks the run cut and ends the process', async () => {
    const run = await runRipgrep({
      processes: testProcesses(),
      file: process.execPath,
      args: ['-e', `process.stdout.write('x'.repeat(${MAX_GREP_RAW_CHARS * 3}))`],
      cwd: process.cwd(),
      signal: new AbortController().signal,
    });

    expect(run.cut).toBe(true);
    expect(run.stdout).toHaveLength(MAX_GREP_RAW_CHARS);
    expect(run.timedOut).toBe(false);
  });

  it('does not mark a run that fits as cut', async () => {
    const run = await runRipgrep({
      processes: testProcesses(),
      file: process.execPath,
      args: ['-e', "process.stdout.write('héllo')"],
      cwd: process.cwd(),
      signal: new AbortController().signal,
    });

    expect(run).toMatchObject({ cut: false, stdout: 'héllo', exitCode: 0 });
  });
});

const run = (over: Partial<RipgrepRun>): RipgrepRun => ({
  stdout: '',
  stderr: '',
  exitCode: 0,
  cut: false,
  timedOut: false,
  ...over,
});

describe('assertRanToTheEnd', () => {
  it.each([0, 1])('takes exit %s as a result', (exitCode) => {
    expect(() => assertRanToTheEnd(run({ exitCode }))).not.toThrow();
  });

  it('takes exit 2 with output as a partial result, for the caller to report', () => {
    expect(() => assertRanToTheEnd(run({ exitCode: 2, stdout: 'a\0' }))).not.toThrow();
  });

  it("fails exit 2 with nothing found, with ripgrep's message", () => {
    expect(() => assertRanToTheEnd(run({ exitCode: 2, stderr: 'regex parse error\n' }))).toThrow(
      'regex parse error',
    );
  });

  it('fails a process that died without an exit code, never "no matches"', () => {
    expect(() => assertRanToTheEnd(run({ exitCode: null }))).toThrow('ripgrep failed');
    expect(() => assertRanToTheEnd(run({ exitCode: 137 }))).toThrow('ripgrep failed');
  });

  it('fails a timeout, telling the agent to narrow the search', () => {
    expect(() => assertRanToTheEnd(run({ exitCode: null, timedOut: true }))).toThrow(
      'Narrow it with path or glob',
    );
  });

  it('accepts a search stopped on purpose for printing too much', () => {
    expect(() => assertRanToTheEnd(run({ exitCode: null, cut: true }))).not.toThrow();
  });
});
