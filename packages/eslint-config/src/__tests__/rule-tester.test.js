import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, vi } from 'vitest';
import { kindContents } from '../rules/kind-contents.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const root = tempWorkspace({
  'tsconfig.json': {
    compilerOptions: { strict: true, module: 'NodeNext', moduleResolution: 'NodeNext' },
    include: ['src/**/*.ts'],
  },
  'src/text.constants.ts': '',
  'src/text.prompt.ts': "export const TEXT = 'Policy.'; export const WIDE: string = TEXT;",
});
const filename = path.join(root, 'src/text.constants.ts');

beforeAll(() => vi.stubEnv('CI', 'true'));
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

typescriptRuleTester({
  parserOptions: { project: path.join(root, 'tsconfig.json'), tsconfigRootDir: root },
}).run('typed fixtures remain independent under CI single-run inference', kindContents, {
  valid: [
    { code: "import { TEXT } from './text.prompt.js'; export const PUBLIC_TEXT = TEXT;", filename },
    {
      code: "import { TEXT as PROMPT } from './text.prompt.js'; export const TEXT = PROMPT;",
      filename,
    },
  ],
  invalid: [
    {
      code: "import { WIDE } from './text.prompt.js'; export const PUBLIC_TEXT = WIDE;",
      filename,
      errors: [{ messageId: 'codeInConstants' }],
    },
  ],
});
