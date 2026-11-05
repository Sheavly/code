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
    [['python3', 'tool.py'], 'python3 tool.py'],
  ])('keeps what npm runs in %j: %s', (argv, entry) => {
    expect(suggestEntry(argv)).toBe(entry);
  });

  describe('a program that can run other programs or change files keeps the exact command', () => {
    it.each([
      [['npx', 'vitest', 'run', 'a'], 'npx vitest run a'],
      [['npx', 'turbo', 'run', 'typecheck'], 'npx turbo run typecheck'],
      [['node', 'scripts/check.mjs', '--fix'], 'node scripts/check.mjs --fix'],
      [['find', 'apps/terminal', '-name', '*.ts'], 'find apps/terminal -name *.ts'],
      [['find', 'apps/terminal', '-type', 'f'], 'find apps/terminal -type f'],
      [['xargs', 'rm'], 'xargs rm'],
      [['sed', '-n', '1p', 'a.txt'], 'sed -n 1p a.txt'],
      [['make', 'build', 'test'], 'make build test'],
      [['curl', 'https://example.com', '-o', 'x'], 'curl https://example.com -o x'],
      [['env', 'FOO=1', 'ls', 'src'], 'env FOO=1 ls src'],
      [['bash', 'build.sh', 'now'], 'bash build.sh now'],
    ])('%j: %s', (argv, entry) => {
      expect(suggestEntry(argv)).toBe(entry);
    });

    it.each([
      [['/usr/bin/find', 'src', '-type', 'f'], '/usr/bin/find src -type f'],
      [['./find', 'src', '-type', 'f'], './find src -type f'],
      [['FIND.EXE', 'src', '-type', 'f'], 'FIND.EXE src -type f'],
      [['python3.12', 'tool.py', '--go'], 'python3.12 tool.py --go'],
      [['python', 'tool.py', '--go'], 'python tool.py --go'],
      [['npm', 'exec', 'turbo', 'run', 'x'], 'npm exec turbo run x'],
      [['npm', 'x', 'turbo', 'run', 'x'], 'npm x turbo run x'],
    ])('wherever it lives, and by another name: %j', (argv, entry) => {
      expect(suggestEntry(argv)).toBe(entry);
    });

    it('never lets one approval allow what the approved command did not say', () => {
      for (const argv of [
        ['find', 'src', '-type', 'f'],
        ['npx', 'vitest', 'run'],
        ['node', 'a.mjs', 'x'],
        ['npm', 'exec', 'tool', 'x'],
      ]) {
        const entry = suggestEntry(argv) ?? '';

        expect(entry).not.toContain('*');
        expect(isAllowed({ argv, allowList: [entry] })).toBe(true);
        expect(isAllowed({ argv: [...argv, '-exec', 'rm'], allowList: [entry] })).toBe(false);
      }
    });
  });

  describe('a searcher keeps a wildcard, whatever its first word is', () => {
    it.each([
      [['grep', '-rnE', 'a|b', 'src', '--include=*.ts'], 'grep *'],
      [['grep', 'needle', 'src/a.ts'], 'grep *'],
      [['grep', '-c', 'x'], 'grep *'],
      [['egrep', 'a|b', 'src'], 'egrep *'],
      [['fgrep', '-n', 'x'], 'fgrep *'],
      [['grep'], 'grep'],
    ])('%j: %s', (argv, entry) => {
      expect(suggestEntry(argv)).toBe(entry);
    });

    it('allows other searches, and only searches', () => {
      const entry = suggestEntry(['grep', '-rn', 'x', 'src']) ?? '';

      expect(isAllowed({ argv: ['grep', '-ln', 'y', 'docs'], allowList: [entry] })).toBe(true);
      expect(isAllowed({ argv: ['git', 'grep', 'y'], allowList: [entry] })).toBe(false);
      expect(isAllowed({ argv: ['rg', 'y'], allowList: [entry] })).toBe(false);
    });

    it.each([
      [['rg', '-n', 'x'], 'rg -n x'],
      [['ag', 'x', 'src'], 'ag x *'],
      [['ack', '-i', 'x'], 'ack -i x'],
    ])('does not treat %j as a searcher, since it can run a program: %s', (argv, entry) => {
      expect(suggestEntry(argv)).toBe(entry);
    });

    it.each([
      [['./grep', '-rn', 'x'], './grep -rn x'],
      [['./grep', 'x', 'src'], './grep x *'],
      [['/opt/tool/grep', '-rn', 'x'], '/opt/tool/grep -rn x'],
    ])(
      'does not trust a grep given as a path, which may be a file the agent wrote: %j',
      (argv, entry) => {
        expect(suggestEntry(argv)).toBe(entry);
      },
    );
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
