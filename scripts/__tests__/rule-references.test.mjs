import { afterEach, describe, expect, it } from 'vitest';
import { ruleReferenceProblems } from '../rule-references.mjs';
import { createTempRepo, removeTempRepos } from './temp-repo.utils.mjs';

afterEach(removeTempRepos);

const ALLOWLIST = 'scripts/rule-references.allowlist.json';
const FILES = {
  'package.json': JSON.stringify({
    name: '@sheavly/harness',
    workspaces: ['packages/*'],
    scripts: { check: 'turbo run check' },
  }),
  'eslint.config.js': "export default [{ rules: { 'harness/no-raw-error': 'error' } }];\n",
  'packages/core/package.json': JSON.stringify({
    name: '@sheavly/core',
    scripts: { schema: 'node schema.js' },
  }),
  'packages/core/src/tool/tool.utils.ts': 'export function defineTool() {}\n',
  'packages/core/src/tool/__tests__/tool.utils.test.ts': 'const madeUpName = 1;\n',
  '.agents/skills/demo/SKILL.md': '# Demo\n',
  [ALLOWLIST]: '{}\n',
};

const problems = (files) => {
  const all = { ...FILES, ...files };

  return ruleReferenceProblems({ root: createTempRepo(all), files: Object.keys(all) });
};

describe('rule references', () => {
  it('passes paths, imports, folders, scripts, lint rules and names that exist', () => {
    const agents = [
      'See `packages/core/src/tool/tool.utils.ts`, `tool/tool.utils` and `../tool/tool.utils.js`.',
      'Import `@sheavly/core/tool/tool.utils`; tools live in `@sheavly/core/tool/`.',
      'Run `npm run check` and `npm run schema -w @sheavly/core`.',
      'Lint has `harness/no-raw-error`; build tools with `defineTool({ name })`.',
      'Prose such as `--force`, `idle` and `https://example.com/x` is skipped.',
      '```ts',
      'missingInFence();',
      '```',
    ].join('\n');

    expect(problems({ 'AGENTS.md': agents })).toEqual([]);
  });

  it('fails each kind of reference to code that is gone, with its file and line', () => {
    const agents = [
      'See `packages/core/src/gone/gone.utils.ts`.',
      'Import `@sheavly/core/tool/tool.helper`.',
      'Run `npm run lint` and `npm run check -w @sheavly/core`.',
      'Lint has `harness/no-such-rule`; call `createGoneTool()`.',
    ].join('\n');

    expect(problems({ 'AGENTS.md': agents })).toEqual([
      'AGENTS.md:1: `packages/core/src/gone/gone.utils.ts`: no file or folder in the repo matches this path.',
      'AGENTS.md:2: `@sheavly/core/tool/tool.helper`: no workspace has this module or folder.',
      'AGENTS.md:3: `npm run lint`: neither the root nor any workspace has a `lint` script.',
      'AGENTS.md:3: `npm run check -w @sheavly/core`: `@sheavly/core` has no `check` script.',
      'AGENTS.md:4: `harness/no-such-rule`: no lint config sets this rule.',
      'AGENTS.md:4: `createGoneTool()`: `createGoneTool` appears in no code in the repo.',
      expect.stringContaining('Update it to the current name or path'),
    ]);
  });

  it("checks the skills too, and counts neither Markdown nor tests' fixtures as code", () => {
    const skill = '# Demo\n\nUse `madeUpName` and `fromTheDocs`.\n';

    expect(
      problems({
        'AGENTS.md': 'Nothing here.\n',
        '.agents/skills/demo/SKILL.md': skill,
        'docs/notes.md': 'const fromTheDocs = 1;\n',
      }),
    ).toEqual([
      '.agents/skills/demo/SKILL.md:3: `madeUpName`: `madeUpName` appears in no code in the repo.',
      '.agents/skills/demo/SKILL.md:3: `fromTheDocs`: `fromTheDocs` appears in no code in the repo.',
      expect.stringContaining('Update it to the current name or path'),
    ]);
  });

  it('lets the allow-list excuse a name, and fails an entry nothing needs', () => {
    const allowlist = JSON.stringify({
      isDraft: 'A gh --json field.',
      staleEntry: 'Was needed once.',
    });

    expect(
      problems({ 'AGENTS.md': 'Read `isDraft` from `gh pr view`.\n', [ALLOWLIST]: allowlist }),
    ).toEqual([expect.stringContaining('`staleEntry` is no longer needed')]);
  });

  it('refuses an allow-list entry without a reason', () => {
    expect(() => {
      problems({ 'AGENTS.md': 'Nothing here.\n', [ALLOWLIST]: JSON.stringify({ isDraft: ' ' }) });
    }).toThrow('`isDraft` needs a reason');
  });
});
