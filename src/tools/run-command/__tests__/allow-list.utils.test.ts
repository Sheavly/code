import { describe, expect, it } from 'vitest';
import { isAllowed, matchesEntry, parseCommand } from '../allow-list.utils.js';

describe('parseCommand', () => {
  it('splits words and honours quotes', () => {
    expect(parseCommand(`git commit -m "fix bug" --author 'A B'`)).toEqual({
      ok: true,
      argv: ['git', 'commit', '-m', 'fix bug', '--author', 'A B'],
    });
  });

  it.each([
    'ls; rm -rf /',
    'ls && rm x',
    'ls | sh',
    'echo $HOME',
    'echo `id`',
    'ls > out',
    'echo $(id)',
    'ls\nrm x',
  ])('rejects shell syntax in %j', (command) => {
    expect(parseCommand(command)).toMatchObject({ ok: false });
  });

  it('rejects unbalanced quotes and empty commands', () => {
    expect(parseCommand(`echo "oops`)).toMatchObject({ ok: false, reason: 'unbalanced quotes' });
    expect(parseCommand('   ')).toMatchObject({ ok: false, reason: 'empty command' });
  });
});

describe('matchesEntry', () => {
  it('exact entries match only the exact command', () => {
    expect(matchesEntry({ argv: ['git', 'status'], entry: 'git status' })).toBe(true);
    expect(matchesEntry({ argv: ['git', 'status', '--short'], entry: 'git status' })).toBe(false);
    expect(matchesEntry({ argv: ['git'], entry: 'git status' })).toBe(false);
  });

  it('entries ending in * allow any extra arguments', () => {
    expect(matchesEntry({ argv: ['git', 'diff'], entry: 'git diff *' })).toBe(true);
    expect(matchesEntry({ argv: ['git', 'diff', 'src/'], entry: 'git diff *' })).toBe(true);
    expect(matchesEntry({ argv: ['git', 'push'], entry: 'git diff *' })).toBe(false);
  });

  it('checks the whole list', () => {
    expect(isAllowed({ argv: ['pwd'], allowList: ['ls *', 'pwd'] })).toBe(true);
    expect(isAllowed({ argv: ['rm', '-rf', '/'], allowList: ['ls *', 'pwd'] })).toBe(false);
  });
});
