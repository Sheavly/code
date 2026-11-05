import { describe, expect, it } from 'vitest';
import { safeGrepArgs, safeSteps } from '../run-command.utils.js';

const EXCLUDES = ['--exclude=.[eE][nN][vV]', '--exclude=.[eE][nN][vV].*'];

describe('safeGrepArgs', () => {
  it('adds the .env excludes after the options and operands of a grep', () => {
    expect(safeGrepArgs({ file: 'grep', args: ['-rn', 'KEY', 'src'] })).toEqual([
      '-rn',
      'KEY',
      'src',
      ...EXCLUDES,
    ]);
  });

  it('adds them after a command’s own --include, which would otherwise win', () => {
    const args = safeGrepArgs({ file: 'grep', args: ['-rn', '--include=*', 'KEY', '.'] });

    expect(args.indexOf(EXCLUDES[0] ?? '')).toBeGreaterThan(args.indexOf('--include=*'));
  });

  it('adds them before a --, whose rest is file names and not options', () => {
    expect(safeGrepArgs({ file: 'grep', args: ['-rn', '--', '-KEY', '.'] })).toEqual([
      '-rn',
      ...EXCLUDES,
      '--',
      '-KEY',
      '.',
    ]);
  });

  it('adds them to a grep with no arguments, and to egrep, fgrep and a grep by path', () => {
    expect(safeGrepArgs({ file: 'grep', args: [] })).toEqual(EXCLUDES);
    expect(safeGrepArgs({ file: 'egrep', args: ['x'] })).toEqual(['x', ...EXCLUDES]);
    expect(safeGrepArgs({ file: 'fgrep', args: ['x'] })).toEqual(['x', ...EXCLUDES]);
    expect(safeGrepArgs({ file: '/usr/bin/grep', args: ['x'] })).toEqual(['x', ...EXCLUDES]);
  });

  it.each(['ls', 'git', 'cat', 'rg', 'head'])('leaves %s alone', (file) => {
    expect(safeGrepArgs({ file, args: ['-rn', 'x'] })).toEqual(['-rn', 'x']);
  });

  it('does not change the arguments it was given', () => {
    const args = ['-rn', 'x'];

    safeGrepArgs({ file: 'grep', args });

    expect(args).toEqual(['-rn', 'x']);
  });
});

describe('safeSteps', () => {
  it('applies the grep excludes to each grep in a line, and keeps the connectors', () => {
    const [first, second, third] = safeSteps([
      { argv: ['grep', '-rn', 'A', '.'], joinedBy: '|' },
      { argv: ['head', '-n', '3'], joinedBy: '&&' },
      { argv: ['grep', 'B', 'x'] },
    ]).map((step) => step);

    expect(first).toEqual({ argv: ['grep', '-rn', 'A', '.', ...EXCLUDES], joinedBy: '|' });
    expect(second).toEqual({ argv: ['head', '-n', '3'], joinedBy: '&&' });
    expect(third).toEqual({ argv: ['grep', 'B', 'x', ...EXCLUDES] });
  });
});
