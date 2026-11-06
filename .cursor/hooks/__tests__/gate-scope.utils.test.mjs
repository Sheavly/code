import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFiles } from '../../../packages/eslint-config/src/testing/workspace.fake.js';
import {
  gateScope,
  scopedCloneReport,
  scopedFiles,
  scopedReport,
  scopedTurboReport,
  turboFilters,
} from '../gate-scope.utils.mjs';

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const manifest = (name, dependencies = {}) => JSON.stringify({ name, dependencies });

/** core ← host ← server, and an unrelated tools. */
function repo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gate-scope-'));

  roots.push(root);
  writeFiles({
    root,
    files: {
      'package.json': JSON.stringify({ name: '@sheavly/harness', workspaces: ['packages/*'] }),
      'packages/core/package.json': manifest('@sheavly/core'),
      'packages/host/package.json': manifest('@sheavly/host', { '@sheavly/core': '*' }),
      'packages/server/package.json': manifest('@sheavly/server', { '@sheavly/host': '*' }),
      'packages/tools/package.json': manifest('@sheavly/tools'),
    },
  });

  return root;
}

const scopeOf = (params) => {
  const { files, othersEdited = [], dirty = othersEdited } = params;

  return gateScope({
    root: params.root,
    files,
    dirty: new Set(dirty),
    othersEdited: new Set(othersEdited),
  });
};

describe('gateScope', () => {
  it("holds a chat to its workspaces and their importers, not another chat's", () => {
    const root = repo();
    const scope = scopeOf({
      root,
      files: ['packages/core/src/a/a.utils.ts'],
      othersEdited: ['packages/server/src/s/s.utils.ts'],
    });

    expect(scope.names).toEqual(['@sheavly/core', '@sheavly/host']);
    expect(turboFilters(scope)).toEqual(['--filter=@sheavly/core', '--filter=@sheavly/host']);
  });

  it('keeps a workspace both chats edited, and an importer whose other edits are committed', () => {
    const root = repo();
    const scope = scopeOf({
      root,
      files: ['packages/core/src/a/a.utils.ts', 'packages/server/src/s/s.utils.ts'],
      othersEdited: ['packages/server/src/s/s.utils.ts', 'packages/host/src/h/h.utils.ts'],
      dirty: ['packages/server/src/s/s.utils.ts'],
    });

    expect(scope.names).toEqual(['@sheavly/core', '@sheavly/host', '@sheavly/server']);
  });

  it("adds the root's tasks for a file outside every workspace, and the graph docs for a manifest", () => {
    const root = repo();
    const scope = scopeOf({ root, files: ['scripts/x.mjs', 'packages/tools/package.json'] });

    expect(turboFilters(scope)).toEqual(['--filter=@sheavly/tools', '--filter=//']);
    expect(scope.files).toContain('docs/overview.md');
  });
});

describe('scopedReport', () => {
  const root = '/repo';
  const scope = {
    files: new Set(['scripts/x.mjs']),
    names: ['@sheavly/core'],
    dirs: ['packages/core'],
    root: true,
    everyWorkspace: ['@sheavly/core', 'packages/core', '@sheavly/server', 'packages/server'],
  };

  it("keeps the problems naming the chat's files or workspaces, with their section titles", () => {
    const knip = [
      'Unused files (2)',
      'packages/server/src/a.ts',
      'packages/core/src/b.ts',
      'Unused devDependencies (1)',
      '@sheavly/testing  packages/server/package.json:43:6',
    ].join('\n');
    const layout = [
      "@sheavly/core's tool/ is public but its README has no row for it.",
      '/repo/scripts/x.mjs: links to y.md, which does not exist.',
      'packages/core-extra/src/c.ts: not core',
    ].join('\n');

    expect(scopedReport({ output: knip, scope, root })).toBe(
      ['Unused files (2)', 'packages/core/src/b.ts'].join('\n'),
    );
    expect(scopedReport({ output: layout, scope, root })).toBe(
      [
        "@sheavly/core's tool/ is public but its README has no row for it.",
        '/repo/scripts/x.mjs: links to y.md, which does not exist.',
      ].join('\n'),
    );
  });

  it("is null when every problem is another chat's, and whole when the tool itself failed", () => {
    const crash = ['Error: Cannot find module', '    at /usr/lib/node/x.js:1:1'].join('\n');

    expect(scopedReport({ output: 'packages/server/src/a.ts', scope, root })).toBeNull();
    expect(scopedReport({ output: crash, scope, root })).toBe(crash);
    expect(scopedReport({ output: '', scope, root })).toContain('failed without printing why');
  });
});

describe('scopedCloneReport', () => {
  const root = '/repo';
  const scope = {
    files: new Set(),
    names: ['@sheavly/core'],
    dirs: ['packages/core'],
    root: false,
    everyWorkspace: ['@sheavly/core', 'packages/core', '@sheavly/runtime', 'packages/runtime'],
  };
  const summary = [
    '┌────────────┬────────────────┐',
    '│ Format     │ Files analyzed │',
    'Found 1 clones.',
    'Using config from .jscpd.json',
    'ERROR: jscpd found too many duplicates (0.0%) over threshold (0.0%)',
  ];
  const clone = (file) => [
    'Clone found (typescript)',
    ` - ${file} [1:1 - 9:2] (9 lines, 53 tokens)`,
    `   ${file} [20:1 - 28:2]`,
  ];

  it("is null when every clone is in another chat's files, whatever the summary says", () => {
    const output = [...clone('packages/runtime/src/a.test.ts'), ...summary].join('\n');

    expect(scopedCloneReport({ output, scope, root })).toBeNull();
  });

  it("keeps the clones with a file in the chat's scope, without the summary or colors", () => {
    const mine = clone('packages/core/src/b.ts');
    const output = [
      ...clone('packages/runtime/src/a.test.ts'),
      ...mine.map((line) => `\u001B[1m${line}\u001B[22m`),
      ...summary,
    ].join('\n');

    expect(scopedCloneReport({ output, scope, root })).toBe(mine.join('\n'));
  });

  it('keeps a report with no clone in it whole, so a jscpd that failed to run is said', () => {
    const crash = ['Error: Cannot find module', '    at /usr/lib/node/x.js:1:1'].join('\n');

    expect(scopedCloneReport({ output: crash, scope, root })).toBe(crash);
  });
});

describe('scopedFiles', () => {
  it("keeps only the chat's own changed files for the docs and real-model nudges", () => {
    const scope = { files: new Set(['scripts/x.mjs']) };
    const files = ['scripts/x.mjs', 'apps/terminal/src/chat.ts'];

    expect(scopedFiles({ files, scope })).toEqual(['scripts/x.mjs']);
    expect(scopedFiles({ files, scope: null })).toEqual(files);
    expect(scopedFiles({ files: undefined, scope })).toBeUndefined();
  });
});

describe('scopedTurboReport', () => {
  const scope = { names: ['@sheavly/core'], root: false };

  it("keeps the scope's tasks, and is null when only other workspaces failed", () => {
    const report = [
      '@sheavly/core:lint: src/a.ts  1:1  error  bad',
      '@sheavly/server:typecheck: src/s.ts(5,3): error TS2305',
      'Failed:    @sheavly/core#lint, @sheavly/server#typecheck',
    ].join('\n');

    expect(scopedTurboReport({ report, scope })).toBe(
      [
        '@sheavly/core:lint: src/a.ts  1:1  error  bad',
        'Failed:    @sheavly/core#lint, @sheavly/server#typecheck',
      ].join('\n'),
    );
    expect(scopedTurboReport({ report: report.split('\n').slice(1).join('\n'), scope })).toBeNull();
  });

  it('keeps a report turbo printed before running any task', () => {
    expect(scopedTurboReport({ report: 'x  turbo.json is invalid', scope })).toBe(
      'x  turbo.json is invalid',
    );
  });
});
