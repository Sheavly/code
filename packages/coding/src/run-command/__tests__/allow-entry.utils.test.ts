import { describe, expect, it } from 'vitest';
import { suggestEntry } from '../allow-entry.utils.js';
import { isAllowed } from '../allow-list.utils.js';

describe('suggestEntry', () => {
  it.each([
    [['git', 'log', '--oneline', '-5'], 'git log *'],
    [['git', 'status'], 'git status'],
    [['git', 'diff', 'src/a.ts'], 'git diff *'],
    [['ls'], 'ls'],
    [['ls', 'src'], 'ls src'],
    [['ls', 'src', 'docs'], 'ls src *'],
    [['pwd'], 'pwd'],
  ])('stores the first two words of %j: %s', (argv, entry) => {
    expect(suggestEntry(argv)).toBe(entry);
  });

  it.each([
    [['npm', 'run', 'test', '-w', 'x'], 'npm run test *'],
    [['npm', 'run', 'build'], 'npm run build'],
    [['npm', 'test'], 'npm test'],
    [['npm', 'install', 'left-pad'], 'npm install *'],
    [['npx', 'vitest', 'run', 'a'], 'npx vitest *'],
    [['node', 'scripts/check.mjs', '--fix'], 'node scripts/check.mjs *'],
    [['python3', 'tool.py'], 'python3 tool.py'],
  ])('keeps what a runner runs in %j: %s', (argv, entry) => {
    expect(suggestEntry(argv)).toBe(entry);
  });

  it.each([
    [['git', '-c', 'core.pager=x', 'log'], 'git -c core.pager=x log'],
    [['ls', '-la'], 'ls -la'],
    [['rm', '-rf', 'build'], 'rm -rf build'],
  ])('stores only the exact command when a flag comes second: %j', (argv, entry) => {
    expect(suggestEntry(argv)).toBe(entry);
  });

  it('stores nothing for a command an entry cannot spell', () => {
    expect(suggestEntry([])).toBeUndefined();
    expect(suggestEntry(['git', 'commit', '-m', 'a b'])).toBeUndefined();
    expect(suggestEntry(['rm', '*'])).toBeUndefined();
    expect(suggestEntry(['echo', ''])).toBeUndefined();
  });

  it('never stores an entry wider than the command the user approved', () => {
    const approved = ['git', 'log', '--oneline'];
    const entry = suggestEntry(approved) ?? '';

    expect(isAllowed({ argv: approved, allowList: [entry] })).toBe(true);
    expect(isAllowed({ argv: ['git', 'push'], allowList: [entry] })).toBe(false);
    expect(isAllowed({ argv: ['git'], allowList: [entry] })).toBe(false);
  });

  it('stores an entry that allows the command it came from, whatever the command', () => {
    for (const argv of [
      ['ls'],
      ['npm', 'run', 'x', '--y'],
      ['git', '-C', 'a', 'log'],
      ['a', 'b'],
    ]) {
      expect(isAllowed({ argv, allowList: [suggestEntry(argv) ?? ''] })).toBe(true);
    }
  });
});
