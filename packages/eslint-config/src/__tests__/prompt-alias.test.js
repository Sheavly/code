import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll } from 'vitest';
import { kindContents } from '../rules/kind-contents.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const root = tempWorkspace({
  'tsconfig.json': {
    compilerOptions: {
      strict: true,
      target: 'ESNext',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      allowImportingTsExtensions: true,
      noEmit: true,
    },
    include: ['**/*.ts'],
  },
  'src/text.constants.ts': '',
  'src/text.prompt.ts': `
    export const TEXT = 'Follow the policy.';
    export const TEMPLATE = \`Follow \${TEXT}\` as const;
    export const WIDE: string = TEXT;
    export const UNION: 'one' | 'two' = 'one' as 'one' | 'two';
    export const ANY: any = TEXT;
    export const UNKNOWN: unknown = TEXT;
    export const NUMBER = 1;
    export const DATA = { guidance: TEXT } as const;
    export const SCHEMA = { parse: (value: string): string => value };
    export function render(): 'Follow the policy.' { return TEXT; }
    export const renderer = (): string => TEXT;
    export default TEXT;
  `,
  'src/text.utils.ts': `
    export const TEXT = 'Follow the policy.';
    export function render(): string { return TEXT; }
  `,
  'remote.prompt.ts': "export const TEXT = 'Remote policy.';",
  'src/nested/text.prompt.ts': "export const TEXT = 'Nested policy.';",
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const filename = path.join(root, 'src/text.constants.ts');
const valid = (code) => ({ code, filename });
const invalid = (code) => ({ code, filename, errors: [{ messageId: 'codeInConstants' }] });
const tester = typescriptRuleTester({
  parserOptions: { project: path.join(root, 'tsconfig.json'), tsconfigRootDir: root },
});

tester.run('constants aliases of adjacent imported literal prompt data', kindContents, {
  valid: [
    valid("import { TEXT } from './text.prompt.js'; export const PUBLIC_TEXT = TEXT;"),
    valid("import { TEXT as PROMPT } from './text.prompt.js'; export const TEXT = PROMPT;"),
    valid("import { TEXT } from './text.prompt.ts'; export const PUBLIC_TEXT = TEXT;"),
    valid("import { TEMPLATE } from './text.prompt.js'; export const PUBLIC_TEXT = TEMPLATE;"),
    valid("export const TEXT = 'Existing literal constants stay valid.';"),
  ],
  invalid: [
    invalid("import { render } from './text.prompt.js'; export const PUBLIC_TEXT = render;"),
    invalid("import { renderer } from './text.prompt.js'; export const PUBLIC_TEXT = renderer;"),
    invalid("import { render } from './text.prompt.js'; export const PUBLIC_TEXT = render();"),
    invalid("import { WIDE } from './text.prompt.js'; export const PUBLIC_TEXT = WIDE;"),
    invalid("import { UNION } from './text.prompt.js'; export const PUBLIC_TEXT = UNION;"),
    invalid("import { ANY } from './text.prompt.js'; export const PUBLIC_TEXT = ANY;"),
    invalid("import { UNKNOWN } from './text.prompt.js'; export const PUBLIC_TEXT = UNKNOWN;"),
    invalid("import { NUMBER } from './text.prompt.js'; export const PUBLIC_TEXT = NUMBER;"),
    invalid("import { DATA } from './text.prompt.js'; export const PUBLIC_TEXT = DATA;"),
    invalid("import { SCHEMA } from './text.prompt.js'; export const PUBLIC_TEXT = SCHEMA;"),
    invalid("import { TEXT } from './text.utils.js'; export const PUBLIC_TEXT = TEXT;"),
    invalid("import { render } from './text.utils.js'; export const PUBLIC_TEXT = render;"),
    invalid("import TEXT from './text.prompt.js'; export const PUBLIC_TEXT = TEXT;"),
    invalid("import * as prompt from './text.prompt.js'; export const PUBLIC_TEXT = prompt;"),
    invalid("import * as prompt from './text.prompt.js'; export const PUBLIC_TEXT = prompt.TEXT;"),
    invalid("import type { TEXT } from './text.prompt.js'; export const PUBLIC_TEXT = TEXT;"),
    invalid("import { type TEXT } from './text.prompt.js'; export const PUBLIC_TEXT = TEXT;"),
    invalid("import { TEXT } from '../remote.prompt.js'; export const PUBLIC_TEXT = TEXT;"),
    invalid("import { TEXT } from './nested/text.prompt.js'; export const PUBLIC_TEXT = TEXT;"),
    invalid("import { TEXT } from './missing.prompt.js'; export const PUBLIC_TEXT = TEXT;"),
    invalid("import { TEXT } from './text.prompt.js'; export let PUBLIC_TEXT = TEXT;"),
    invalid("const TEXT = 'Local text.'; export const PUBLIC_TEXT = TEXT;"),
    invalid(
      "import { TEXT } from './text.prompt.js'; const LOCAL = TEXT; export const PUBLIC_TEXT = LOCAL;",
    ),
  ],
});

typescriptRuleTester().run('untyped prompt aliases fail closed', kindContents, {
  valid: [],
  invalid: [
    invalid("import { TEXT } from './text.prompt.js'; export const PUBLIC_TEXT = TEXT;"),
    invalid("import { TEXT as PROMPT } from './text.prompt.js'; export const TEXT = PROMPT;"),
  ],
});
