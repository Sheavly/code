import { readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { systemPromptReview } from '../rules/system-prompt-review.js';
import { promptReviewHashes, watchedPromptSources } from '../rules/system-prompt-review.utils.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { tempWorkspace, writeFiles } from '../testing/workspace.fake.js';

const ANCHOR = 'packages/host/src/instructions/instructions.prompt.ts';
const TOOL = 'packages/tools/src/example/example.tool.ts';
const CONSTANTS = 'packages/tools/src/example/example.constants.ts';
const OTHER_PROMPT = 'packages/host/src/child/child.prompt.ts';
const PROMPT = 'Use tools responsibly.\nReview output.';
const roots = [];

function workspace(extra = {}) {
  const root = tempWorkspace({
    'package.json': { workspaces: ['packages/*', 'apps/*'] },
    'packages/host/package.json': { sheavly: { domain: 'generic' } },
    'packages/tools/package.json': { sheavly: { domain: 'generic' } },
    [ANCHOR]: 'export const BASE_AGENT_INSTRUCTIONS = `disk prompt`;\n',
    [TOOL]: 'export const createTool = () => 1;\n',
    [CONSTANTS]: 'export const DESCRIPTION = "example";\n',
    [OTHER_PROMPT]: 'export const CHILD = "Child role.";\n',
    ...extra,
  });

  roots.push(root);

  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function record(root, overrides = {}, prompt = PROMPT) {
  return {
    version: 1,
    ...promptReviewHashes({ root, prompt }),
    decision: 'prompt-updated',
    reason: 'Checked tool descriptions and kept instructions consistent.',
    ...overrides,
  };
}

function code(review, prompt = PROMPT) {
  const comment =
    review === undefined ? '' : `/* @system-prompt-review ${JSON.stringify(review)} */\n`;

  return `${comment}export const BASE_AGENT_INSTRUCTIONS = \`${prompt}\`;\n`;
}

function lint(params) {
  const {
    root,
    text,
    filename = path.join(root, ANCHOR),
    linter = new Linter({ cwd: root }),
  } = params;

  return linter.verify(
    text,
    [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser },
        plugins: { harness: harnessPlugin },
        rules: { 'harness/system-prompt-review': 'error' },
      },
    ],
    filename,
  );
}

const root = workspace();
const hashes = promptReviewHashes({ root, prompt: PROMPT });
const tester = typescriptRuleTester();
const testCase = (text) => ({ code: text, filename: path.join(root, ANCHOR), options: [{ root }] });
const invalid = (text) => ({ ...testCase(text), errors: [{ messageId: 'review' }], output: null });

tester.run('system-prompt-review', systemPromptReview, {
  valid: [
    testCase(code(record(root))),
    testCase(
      code(record(root, { decision: 'prompt-unchanged', reason: 'No instruction change needed.' })),
    ),
    testCase(`${code(undefined)}/* @system-prompt-review ${JSON.stringify(record(root))} */`),
    { code: 'export const unrelated = 1;', filename: '/no-workspace/unrelated.constants.ts' },
  ],
  invalid: [
    invalid(code(undefined)),
    invalid('/* @system-prompt-review not JSON */\n' + code(undefined)),
    invalid(code(record(root, { sourcesHash: '0'.repeat(64) }))),
    invalid(code(record(root, { promptHash: '0'.repeat(64) }))),
    invalid(code(record(root, { reason: ' \n\t' }))),
    invalid(code(record(root, { decision: 'approved' }))),
    invalid(code(record(root, { version: 2 }))),
    invalid(code(record(root, { extra: true }))),
    invalid(code(null)),
    invalid(code([])),
    invalid(code(record(root)) + code(record(root)).split('export')[0]),
    invalid(code(record(root)).replace('*/\n', '*/\nconst unrelated = 1;\n')),
    invalid(`// @system-prompt-review ${JSON.stringify(record(root))}\n${code(undefined)}`),
    invalid('export const OTHER = `prompt`;'),
    invalid('const BASE_AGENT_INSTRUCTIONS = `prompt`;'),
    invalid('export const BASE_AGENT_INSTRUCTIONS = "prompt";'),
    invalid('export const BASE_AGENT_INSTRUCTIONS = `dynamic ${value}`;'),
  ],
});

describe('system prompt review drift', () => {
  it('reports expected hashes and review action without offering any fix', () => {
    const [problem] = lint({ root, text: code(undefined) });

    expect(problem.message).toContain(`sourcesHash=${hashes.sourcesHash}`);
    expect(problem.message).toContain(`promptHash=${hashes.promptHash}`);
    expect(problem.message).toContain('Review the production prompt/tool sources');
    expect(problem.message).toContain('decision (prompt-updated or prompt-unchanged)');
    expect(problem.message).toContain('nonblank reason');
    expect(problem.fix).toBeUndefined();
    expect(problem.suggestions).toBeUndefined();
    expect(systemPromptReview.meta.fixable).toBeUndefined();
  });

  it('uses unsaved AST prompt text rather than the disk anchor and ignores its review comment', () => {
    expect(lint({ root, text: code(record(root)) })).toEqual([]);
    expect(
      lint({ root, text: code(record(root, { reason: 'Another valid rationale.' })) }),
    ).toEqual([]);
    expect(lint({ root, text: code(record(root), `${PROMPT} `) })[0].message).toContain(
      'stale prompt',
    );
  });

  it('preserves template source escapes rather than hashing cooked values', () => {
    const prompt = String.raw`A\nB\`C`;

    expect(lint({ root, text: code(record(root, {}, prompt), prompt) })).toEqual([]);
    expect(promptReviewHashes({ root, prompt }).promptHash).not.toBe(
      promptReviewHashes({ root, prompt: 'A\nB`C' }).promptHash,
    );
  });

  it('fails loudly on an anchor with no workspace or broken manifest', () => {
    const noRoot = tempWorkspace({});

    roots.push(noRoot);
    expect(lint({ root: noRoot, text: code(undefined) })[0].message).toContain(
      'missing workspace root',
    );
    expect(lint({ root: noRoot, text: code(undefined) })[0].message).toContain(
      `promptHash=${hashes.promptHash}`,
    );
    writeFiles({ root: noRoot, files: { 'package.json': '{invalid' } });
    expect(lint({ root: noRoot, text: code(undefined) })[0].message).toContain(
      'cannot discover workspace root',
    );
  });

  it('fails closed when the inventory cannot be read', () => {
    const broken = workspace({ 'packages/tools/package.json': '{invalid' });

    expect(lint({ root: broken, text: code(undefined) })[0].message).toContain(
      'cannot read model-facing source inventory',
    );
  });

  it('returns immediately with no context/root/discovery access for unrelated filenames', () => {
    const context = {
      filename: '/no-workspace/unrelated.constants.ts',
      get cwd() {
        throw new Error('must not discover root');
      },
      get options() {
        throw new Error('must not access options');
      },
      get sourceCode() {
        throw new Error('must not access source');
      },
    };

    expect(systemPromptReview.create(context)).toEqual({});
    expect(
      lint({
        root,
        filename: path.join(root, 'unrelated.constants.ts'),
        text: 'export const x = 1;',
      }),
    ).toEqual([]);
  });

  it('skips an anchor-like file in the wrong workspace without reading the inventory', () => {
    const context = {
      filename: path.join(root, 'packages/other', ANCHOR),
      options: [{ root: '/intentionally/nonexistent-root' }],
      get cwd() {
        throw new Error('must not discover root');
      },
      get sourceCode() {
        throw new Error('must not inspect wrong anchor');
      },
    };

    expect(systemPromptReview.create(context)).toEqual({});
    expect(
      lint({
        root,
        filename: path.join(root, 'packages/other/src/instructions/instructions.prompt.ts'),
        text: code(undefined),
      }),
    ).toEqual([]);
  });

  it('does not follow symlinked files or directories', () => {
    const dir = workspace();
    const before = promptReviewHashes({ root: dir, prompt: PROMPT });
    const outside = workspace();

    symlinkSync(
      path.join(outside, TOOL),
      path.join(dir, 'packages/tools/src/example/linked.tool.ts'),
    );
    symlinkSync(
      path.join(outside, OTHER_PROMPT),
      path.join(dir, 'packages/tools/src/example/linked.prompt.ts'),
    );
    symlinkSync(
      path.join(outside, CONSTANTS),
      path.join(dir, 'packages/tools/src/example/linked.constants.ts'),
    );
    symlinkSync(
      path.join(outside, 'packages/tools/src/example'),
      path.join(dir, 'packages/tools/src/linked'),
    );
    symlinkSync(path.join(outside, 'packages/tools'), path.join(dir, 'packages/linked'));
    writeFiles({
      root: dir,
      files: { 'packages/source-link/package.json': { sheavly: { domain: 'coding' } } },
    });
    symlinkSync(
      path.join(outside, 'packages/tools/src'),
      path.join(dir, 'packages/source-link/src'),
    );
    expect(promptReviewHashes({ root: dir, prompt: PROMPT })).toEqual(before);
  });

  it.each([
    [
      'source changes',
      (dir) => writeFiles({ root: dir, files: { [TOOL]: 'export const createTool = () => 2;\n' } }),
    ],
    [
      'formatting changes',
      (dir) =>
        writeFiles({ root: dir, files: { [TOOL]: 'export const createTool  = () => 1;\n' } }),
    ],
    [
      'constants changes',
      (dir) =>
        writeFiles({
          root: dir,
          files: { [CONSTANTS]: 'export const DESCRIPTION = "changed";\n' },
        }),
    ],
    [
      'tool additions',
      (dir) =>
        writeFiles({
          root: dir,
          files: { 'packages/tools/src/new/new.tool.ts': 'export const newTool = 1;' },
        }),
    ],
    ['tool deletions', (dir) => rmSync(path.join(dir, TOOL))],
    [
      'tool renames',
      (dir) =>
        renameSync(
          path.join(dir, TOOL),
          path.join(dir, TOOL.replace('example.tool', 'renamed.tool')),
        ),
    ],
    [
      'prompt changes',
      (dir) =>
        writeFiles({ root: dir, files: { [OTHER_PROMPT]: 'export const CHILD = "New role.";' } }),
    ],
    [
      'prompt additions',
      (dir) =>
        writeFiles({
          root: dir,
          files: { 'packages/host/src/new/new.prompt.ts': 'export const NEW = "New policy.";' },
        }),
    ],
    ['prompt deletions', (dir) => rmSync(path.join(dir, OTHER_PROMPT))],
    [
      'prompt renames',
      (dir) =>
        renameSync(
          path.join(dir, OTHER_PROMPT),
          path.join(dir, OTHER_PROMPT.replace('child.prompt', 'renamed.prompt')),
        ),
    ],
    [
      'new prompt-only workspaces',
      (dir) =>
        writeFiles({
          root: dir,
          files: {
            'packages/new/package.json': { sheavly: { domain: 'generic' } },
            'packages/new/src/model/model.prompt.ts': 'export const MODEL = "New policy.";',
          },
        }),
    ],
    [
      'constants additions',
      (dir) =>
        writeFiles({
          root: dir,
          files: { 'packages/tools/src/example/more.constants.ts': 'export const MORE = 1;' },
        }),
    ],
    ['constants deletions', (dir) => rmSync(path.join(dir, CONSTANTS))],
    [
      'new workspaces',
      (dir) =>
        writeFiles({
          root: dir,
          files: {
            'apps/new/package.json': { sheavly: { domain: 'coding' } },
            'apps/new/src/module/new.tool.ts': 'export const appTool = 1;',
          },
        }),
    ],
  ])(
    'same-process repeated lints detect %s and accept an explicit renewed review',
    (_name, change) => {
      const dir = workspace();
      const linter = new Linter({ cwd: dir });
      const text = code(record(dir));

      expect(lint({ root: dir, text, linter })).toEqual([]);
      change(dir);
      expect(lint({ root: dir, text, linter })[0].message).toContain(
        'stale model-facing source review',
      );
      expect(
        lint({ root: dir, text: code(record(dir, { decision: 'prompt-unchanged' })), linter }),
      ).toEqual([]);
    },
  );

  it('reviews companion constants in a prompt-only module, not just tool modules', () => {
    const file = 'packages/host/src/child/child.constants.ts';
    const dir = workspace({ [file]: 'export const FRAME = "original";' });
    const text = code(record(dir));

    expect(lint({ root: dir, text })).toEqual([]);
    writeFiles({ root: dir, files: { [file]: 'export const FRAME = "updated";' } });
    expect(lint({ root: dir, text })[0].message).toContain('stale model-facing source review');
    expect(lint({ root: dir, text: code(record(dir, { decision: 'prompt-unchanged' })) })).toEqual(
      [],
    );
  });

  it('does not cache by mtime or source size', () => {
    const dir = workspace();
    const before = promptReviewHashes({ root: dir, prompt: PROMPT });
    const file = path.join(dir, TOOL);
    const times = statSync(file);

    writeFiles({ root: dir, files: { [TOOL]: readFileSync(file, 'utf8').replace('1', '2') } });
    utimesSync(file, times.atime, times.mtime);
    expect(promptReviewHashes({ root: dir, prompt: PROMPT }).sourcesHash).not.toBe(
      before.sourcesHash,
    );
  });

  it('excludes tests, fake folders, test-only/tooling workspaces, and nonsibling dependencies', () => {
    const dir = workspace();
    const before = promptReviewHashes({ root: dir, prompt: PROMPT });
    const excluded = Object.fromEntries(
      ['__tests__', 'testing', 'tests', 'test', 'fake', 'fakes'].map((folder) => [
        `packages/tools/src/${folder}/ignored.tool.ts`,
        'export const ignored = 1;',
      ]),
    );

    writeFiles({
      root: dir,
      files: {
        ...excluded,
        'packages/fakes/package.json': { sheavly: { domain: 'generic', testOnly: true } },
        'packages/fakes/src/module/module.tool.ts': 'export const testOnlyTool = 1;',
        'packages/tooling/package.json': { sheavly: { domain: 'tooling' } },
        'packages/tooling/src/build/build.tool.ts': 'export const build = 1;',
        'packages/tools/src/unrelated/unrelated.constants.ts': 'export const unrelated = 1;',
        'packages/tools/src/example/example.helper.ts': 'export const helper = 1;',
      },
    });
    expect(promptReviewHashes({ root: dir, prompt: PROMPT })).toEqual(before);
    expect(watchedPromptSources(dir).map((file) => path.relative(dir, file))).toEqual([
      OTHER_PROMPT,
      CONSTANTS,
      TOOL,
    ]);
  });

  it('is deterministic across roots and manifest/discovery order', () => {
    const first = workspace();
    const second = workspace({ 'package.json': { workspaces: ['apps/*', 'packages/*'] } });

    expect(promptReviewHashes({ root: first, prompt: PROMPT })).toEqual(
      promptReviewHashes({ root: second, prompt: PROMPT }),
    );
  });

  it('is enabled in the real resolved host source config', async () => {
    const repo = path.resolve(import.meta.dirname, '../../../..');
    const eslint = new ESLint({ cwd: path.join(repo, 'packages/host') });
    const config = await eslint.calculateConfigForFile(path.join(repo, ANCHOR));

    expect(config.rules['harness/system-prompt-review'][0]).toBe(2);
  });
});
