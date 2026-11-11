import { cpSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemPromptReview } from '../rules/system-prompt-review.js';
import { promptReviewHashes, watchedPromptSources } from '../rules/system-prompt-review.utils.js';
import { tempWorkspace, writeFiles } from '../testing/workspace.fake.js';

const reads = vi.hoisted(() => []);

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal();

  return {
    ...original,
    readFileSync: (...args) => {
      reads.push(String(args[0]));

      return original.readFileSync(...args);
    },
    readdirSync: (...args) => {
      reads.push(String(args[0]));

      return original.readdirSync(...args);
    },
  };
});

const ANCHOR = 'packages/host/src/instructions/instructions.prompt.ts';
const TOOL = 'packages/tools/src/example/example.tool.ts';
const roots = [];

function fixture(files = {}) {
  const root = tempWorkspace({
    'package.json': { workspaces: ['packages/*', 'apps/*', 'explicit'] },
    'packages/host/package.json': { sheavly: { domain: 'generic' } },
    'packages/tools/package.json': { sheavly: { domain: 'coding' } },
    [ANCHOR]: 'export const BASE_AGENT_INSTRUCTIONS = `Harmless policy`;',
    [TOOL]: 'export const tool = 1;',
    'packages/tools/src/example/example.constants.ts': 'export const VALUE = 1;',
    'apps/demo/package.json': { sheavly: { domain: 'coding' } },
    'apps/demo/src/demo.prompt.ts': 'export const demo = "Harmless demo";',
    'explicit/package.json': { sheavly: { domain: 'generic' } },
    'explicit/src/explicit.prompt.ts': 'export const explicit = "Harmless explicit";',
    ...files,
  });

  roots.push(root);

  return root;
}

function lint(params) {
  const { root, discover = false } = params;
  const linter = new Linter({ cwd: root });

  return linter.verify(
    'export const BASE_AGENT_INSTRUCTIONS = `Harmless policy`;',
    [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser },
        plugins: { inventory: { rules: { review: systemPromptReview } } },
        rules: { 'inventory/review': ['error', ...(discover ? [] : [{ root }])] },
      },
    ],
    path.join(root, ANCHOR),
  );
}

beforeEach(() => {
  reads.length = 0;
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('prompt review inventory confinement', () => {
  it('accepts normal patterns and independent copied roots regardless of physical parent', () => {
    const root = fixture();
    const other = fixture();
    const copy = path.join(other, 'independent-copy');

    cpSync(root, copy, { recursive: true });
    expect(watchedPromptSources(root).map((file) => path.relative(root, file))).toEqual([
      'apps/demo/src/demo.prompt.ts',
      'explicit/src/explicit.prompt.ts',
      'packages/tools/src/example/example.constants.ts',
      TOOL,
    ]);
    expect(promptReviewHashes({ root, prompt: 'policy' })).toEqual(
      promptReviewHashes({ root: copy, prompt: 'policy' }),
    );
    expect(lint({ root: copy, discover: true })[0].message).toContain('missing review record');
  });

  it.each(['../outside/*', '../outside', '/outside/*', 'packages/../../outside/*'])(
    'rejects unsafe pattern %s before reading or enumerating its target',
    (pattern) => {
      const root = fixture({ 'package.json': { workspaces: [pattern] } });

      expect(() => watchedPromptSources(root)).toThrow('Unsafe inventory workspace pattern');
      expect(reads).toEqual([path.join(root, 'package.json')]);
      expect(lint({ root })[0].message).toContain('Unsafe inventory workspace pattern');
    },
  );

  it.each(['linked/*', 'linked/nested/*', 'linked/nested'])(
    'rejects symlink ancestry for %s before any external reads or readdir',
    (pattern) => {
      const outside = fixture();
      const root = fixture({ 'package.json': { workspaces: [pattern] } });

      symlinkSync(outside, path.join(root, 'linked'));
      expect(() => watchedPromptSources(root)).toThrow(path.join(root, 'linked'));
      expect(reads).toEqual([path.join(root, 'package.json')]);
      const [problem] = lint({ root });

      expect(problem.message).toContain('Symlinked inventory path is not allowed');
      expect(problem.message).toContain(path.join(root, 'linked'));
      expect(reads.some((file) => file.startsWith(outside))).toBe(false);
    },
  );

  it.each(['package.json', 'packages/tools/package.json'])(
    'rejects symlinked %s before reading malformed external JSON, including root discovery',
    (manifest) => {
      const outside = fixture({ 'harmless.json': '{"HARMLESS_EXTERNAL_SENTINEL": broken}' });
      const root = fixture();
      const file = path.join(root, manifest);

      rmSync(file);
      symlinkSync(path.join(outside, 'harmless.json'), file);
      expect(() => watchedPromptSources(root)).toThrow(file);
      expect(reads).not.toContain(file);
      expect(reads.some((read) => read.startsWith(outside))).toBe(false);
      const [problem] = lint({ root, discover: true });

      expect(problem.message).toContain('Symlinked inventory path is not allowed');
      expect(problem.message).toContain(file);
      expect(problem.message).not.toContain('HARMLESS_EXTERNAL_SENTINEL');
    },
  );

  it('reports malformed confined metadata by path without JSON snippets', () => {
    const root = fixture({ 'packages/tools/package.json': '{"HARMLESS_LOCAL_SENTINEL": broken}' });
    const [problem] = lint({ root });

    expect(problem.message).toContain(path.join(root, 'packages/tools/package.json'));
    expect(problem.message).not.toContain('HARMLESS_LOCAL_SENTINEL');
    expect(problem.message).toContain('Cannot read inventory manifest');
  });

  it('rejects a root with symlink ancestry before reading its manifest', () => {
    const parent = fixture();
    const outside = fixture();
    const link = path.join(parent, 'linked-root');

    symlinkSync(outside, link);
    expect(() => watchedPromptSources(link)).toThrow(link);
    expect(reads).toEqual([]);
    expect(lint({ root: link })[0].message).toContain(link);
  });

  it('preserves source-link and wildcard workspace-entry skips without changing hashes', () => {
    const root = fixture();
    const outside = fixture();
    const before = promptReviewHashes({ root, prompt: 'policy' });

    symlinkSync(path.join(outside, 'packages/tools'), path.join(root, 'packages/linked'));
    writeFiles({ root, files: { 'packages/source-link/package.json': { sheavly: {} } } });
    symlinkSync(
      path.join(outside, 'packages/tools/src'),
      path.join(root, 'packages/source-link/src'),
    );
    symlinkSync(path.join(outside, TOOL), path.join(root, 'packages/tools/src/linked.tool.ts'));
    symlinkSync(
      path.join(outside, 'explicit/src'),
      path.join(root, 'packages/tools/src/linked-dir'),
    );
    reads.length = 0;
    expect(promptReviewHashes({ root, prompt: 'policy' })).toEqual(before);
    expect(reads.some((file) => file.startsWith(outside))).toBe(false);
  });

  it('includes normal root-owned sources and sibling constants inside an independent root', () => {
    const root = fixture({
      'package.json': { workspaces: [], sheavly: { domain: 'generic' } },
      'src/root.prompt.ts': 'export const policy = "Harmless root policy";',
      'src/root.tool.ts': 'export const tool = 1;',
      'src/root.constants.ts': 'export const LIMIT = 1;',
    });

    expect(watchedPromptSources(root).map((file) => path.relative(root, file))).toEqual([
      'src/root.constants.ts',
      'src/root.prompt.ts',
      'src/root.tool.ts',
    ]);
  });

  it('rechecks metadata confinement on every inventory and accepts repaired metadata', () => {
    const root = fixture();
    const outside = fixture({ 'harmless.json': '{"HARMLESS_EXTERNAL_SENTINEL": broken}' });
    const before = promptReviewHashes({ root, prompt: 'policy' });
    const manifest = path.join(root, 'packages/tools/package.json');

    rmSync(manifest);
    symlinkSync(path.join(outside, 'harmless.json'), manifest);
    reads.length = 0;
    expect(() => promptReviewHashes({ root, prompt: 'policy' })).toThrow(manifest);
    expect(reads).not.toContain(manifest);
    expect(reads.some((file) => file.startsWith(outside))).toBe(false);
    rmSync(manifest);
    writeFiles({
      root,
      files: { 'packages/tools/package.json': { sheavly: { domain: 'coding' } } },
    });
    expect(promptReviewHashes({ root, prompt: 'policy' })).toEqual(before);
  });

  it('treats missing valid wildcard parents and explicit folders as empty matches', () => {
    const root = fixture({ 'package.json': { workspaces: ['missing/*', 'also-missing'] } });

    expect(watchedPromptSources(root)).toEqual([]);
  });
});
