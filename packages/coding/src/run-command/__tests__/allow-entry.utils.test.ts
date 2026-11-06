import { describe, expect, it } from 'vitest';
import { suggestEntry } from '../allow-entry.utils.js';
import { isAllowed } from '../allow-list.utils.js';

describe('base-command grants', () => {
  it.each([
    [['find', 'src', '-type', 'f'], 'find *'],
    [['sed', '-n', '1,200p', 'a.ts'], 'sed *'],
    [['node', '-e', 'anything'], 'node *'],
    [['ls', '-la', '..'], 'ls *'],
    [['cat', '.env'], 'cat *'],
    [['echo', 'a b', ''], 'echo *'],
    [['git', 'diff', '--', '.env'], 'git diff *'],
    [['git', '-C', '..', '-c', 'x=y', 'diff', '--stat'], 'git diff *'],
    [['git', '-Cother', 'show', 'HEAD'], 'git show *'],
    [['npm', 'run', 'test', '--script-shell=node'], 'npm run test *'],
    [['npm', '--workspace=core', 'run-script', 'test'], 'npm run test *'],
    [['npm', 'run', '-w', 'core', 'test'], 'npm run test *'],
    [['npm', 'test', '--', 'file'], 'npm run test *'],
    [['npm', 'install', 'anything'], 'npm install *'],
    [['npx', '--yes', 'eslint', '--fix', '..'], 'npx eslint *'],
    [['npx', '--package=other', 'eslint', '--config=other'], 'npx eslint *'],
    [['npx', 'vitest@latest', 'watch'], 'npx vitest *'],
    [['npx', '@biomejs/biome@2.0.0', 'check'], 'npx @biomejs/biome *'],
    [['npx', 'tsx', 'tmp/probe.mts'], 'npx tsx *'],
    [['gh', '--repo=other', 'issue', 'view', '1'], 'gh issue view *'],
    [['gh', 'api', 'repos/other'], 'gh api *'],
    [['/usr/bin/find', 'src'], 'find *'],
  ])('stores only the base identity of %j', (argv, entry) => {
    expect(suggestEntry(argv)).toBe(entry);
    expect(isAllowed({ argv, allowList: [entry] })).toBe(true);
  });

  it('can represent a script name containing spaces without adding its arguments', () => {
    const argv = ['npm', 'run', 'test script', '--', 'a b'];
    const entry = suggestEntry(argv) ?? '';

    expect(entry).toBe('exact:["npm","run","test script"]');
    expect(isAllowed({ argv: ['npm', 'run', 'test script', '--watch'], allowList: [entry] })).toBe(
      true,
    );
  });

  it('does not grant an empty command or every executable through *', () => {
    expect(suggestEntry([])).toBeUndefined();
    expect(suggestEntry(['*'])).toBeUndefined();
  });
});
