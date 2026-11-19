import { globSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { promptLocation } from '../rules/prompt-location.js';
import * as ruleTesting from '../testing/rule-tester.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';
import { isTestOrFake } from '../test-paths.utils.js';

const root = tempWorkspace({
  'package.json': { workspaces: ['packages/*'] },
  'packages/new/package.json': { name: '@sheavly/new', sheavly: { domain: 'generic' } },
  'packages/new/tsconfig.json': {
    include: ['src/**/*.ts'],
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true },
  },
  'packages/new/src/extension/extension.types.ts': `
    export type InstructionContribution = { name: string; text: string };
    export type Contributions = {
      tools?: readonly unknown[];
      instructions?: readonly InstructionContribution[];
      baseInstructions?: string;
    };
  `,
  'packages/new/src/model/model.helper.ts': '',
  'packages/new/src/model/__tests__/model.helper.test.ts': '',
  'packages/new/src/model/model.constants.ts': "export const TEXT = 'Follow the policy.';",
  'packages/new/src/model/model.prompt.ts': "export const TEXT = 'Follow the policy.';",
  'packages/new/src/model/text.helper.ts':
    "export function literalText() { return 'Always do the literal thing.'; }",
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const filename = path.join(root, 'packages/new/src/model/model.helper.ts');
const testFilename = path.join(root, 'packages/new/src/model/__tests__/model.helper.test.ts');
const imports =
  "import type { Contributions, InstructionContribution } from '../extension/extension.types.js';";
const tester = ruleTesting.typescriptRuleTester({
  parserOptions: { project: path.join(root, 'packages/new/tsconfig.json'), tsconfigRootDir: root },
});
const returns = (body) => `${imports} export function activate(): Contributions { ${body} }`;
const extract = { messageId: 'extract' };

tester.run('prompt-location instruction sections', promptLocation, {
  valid: [
    {
      code: returns("return { instructions: [{ name: 'coding', text: TEXT }] };").replace(
        imports,
        `${imports} import { TEXT } from './model.prompt.js';`,
      ),
      filename,
    },
    {
      code: returns(
        "return { instructions: [{ name: 'x', text: 'Always do the literal thing.' }] };",
      ),
      filename: testFilename,
    },
    {
      code: "type Note = { name: string; text: string }; const note: Note = { name: 'x', text: 'Shown to the user.' }; export const notes = [{ name: 'y', text: 'Also human text.' }, note];",
      filename,
    },
    {
      code: returns(
        'const text = String(Date.now()); return { instructions: [{ name: "x", text }] };',
      ),
      filename,
    },
  ],
  invalid: [
    {
      code: returns(
        "return { instructions: [{ name: 'x', text: 'Always do the literal thing.' }] };",
      ),
      filename,
      errors: [extract],
    },
    {
      code: returns(
        "const sections = [{ name: 'x', text: 'Always do the literal thing.' }]; return { instructions: sections };",
      ),
      filename,
      errors: [extract],
    },
    {
      code: returns(
        'const name = "x"; return { instructions: [{ name, text: `Always ${name}.` }] };',
      ),
      filename,
      errors: [extract],
    },
    {
      code: returns("return { instructions: [{ name: 'x', text: TEXT }] };").replace(
        imports,
        `${imports} import { TEXT } from './model.constants.js';`,
      ),
      filename,
      errors: [extract],
    },
    {
      code: returns("return { instructions: [{ name: 'x', text: literalText() }] };").replace(
        imports,
        `${imports} import { literalText } from './text.helper.js';`,
      ),
      filename,
      errors: [extract],
    },
    {
      code: `${imports} export const section: InstructionContribution = { name: 'x', text: 'Always do the literal thing.' };`,
      filename,
      errors: [extract],
    },
    {
      code: returns("return { baseInstructions: 'Always do the literal thing.' };"),
      filename,
      errors: [extract],
    },
  ],
});

const REPO = path.resolve(import.meta.dirname, '../../../..');

describe('instruction sections in the real extensions', () => {
  const eslint = new ESLint({
    cwd: REPO,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { projectService: true, tsconfigRootDir: REPO },
        },
        plugins: { harness: harnessPlugin },
        rules: { 'harness/prompt-location': 'error' },
      },
    ],
  });
  const files = globSync('extensions/*/src/**/*.ts', { cwd: REPO }).filter(
    (file) => !isTestOrFake(file) && !file.endsWith('.prompt.ts'),
  );
  const host = 'extensions/coding/src/extension/coding-extension.helper.ts';
  const lintAsHost = async (body) => {
    const code = `import type { Contributions } from '@sheavly/extension/extension/extension.types'; export function activate(): Contributions { ${body} }`;
    const [result] = await eslint.lintText(code, { filePath: path.join(REPO, host) });

    return result.messages.map(({ ruleId }) => ruleId);
  };

  it('finds the production sources to lint', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('reports nothing in them, so the coding contribution passes', async () => {
    const results = await eslint.lintFiles(files);

    expect(results.flatMap(({ messages }) => messages)).toEqual([]);
  }, 120_000);

  it('reports a literal section text in an extension', async () => {
    expect(
      await lintAsHost("return { instructions: [{ name: 'x', text: 'Do the literal thing.' }] };"),
    ).toEqual(['harness/prompt-location']);
  });

  it('reports a literal section text built in a variable first', async () => {
    expect(
      await lintAsHost(
        "const sections = [{ name: 'x', text: 'Do the literal thing.' }]; return { instructions: sections };",
      ),
    ).toEqual(['harness/prompt-location']);
  });
});
