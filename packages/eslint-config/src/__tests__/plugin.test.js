import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';
import { kindOfFile } from '../file-kinds.js';
import { harnessPlugin } from '../plugin.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const {
  'file-kind': fileKind,
  'kind-contents': kindContents,
  'pure-imports': pureImports,
} = harnessPlugin.rules;

describe('kindOfFile', () => {
  it('reads the kind off `<name>.<kind>.ts`', ({ expect }) => {
    expect(kindOfFile('src/runtime/tasks/tasks.service.ts')).toBe('service');
    expect(kindOfFile('src/x/__tests__/allow-list.utils.test.ts')).toBe('test');
    expect(kindOfFile('src/files/files.helper.ts')).toBe('helper');
    expect(kindOfFile('src/workbook/workbook.validator.ts')).toBe('validator');
  });

  it('returns null for unknown kinds, camelCase and kind-less names', ({ expect }) => {
    expect(kindOfFile('src/x/x.helpers.ts')).toBeNull();
    expect(kindOfFile('src/x/fooBar.utils.ts')).toBeNull();
    expect(kindOfFile('src/x/index.ts')).toBeNull();
  });
});

ruleTester.run('file-kind', fileKind, {
  valid: [
    { code: '', filename: 'src/tools/read-file/read-file.tool.ts' },
    { code: '', filename: 'src/tools/read-file/__tests__/read-file.tool.test.ts' },
  ],
  invalid: [
    { code: '', filename: 'src/tools/read-file/readFile.ts', errors: [{ messageId: 'badName' }] },
    {
      code: '',
      filename: 'src/tools/read-file/read-file.test.ts',
      errors: [{ messageId: 'testOutsideFolder' }],
    },
    {
      code: '',
      filename: 'src/tools/read-file/__tests__/setup.utils.ts',
      errors: [{ messageId: 'nonTestInFolder' }],
    },
  ],
});

ruleTester.run('kind-contents', kindContents, {
  valid: [
    {
      code: "import type { z } from 'zod'; export type A = { a: string };",
      filename: 'src/m/m.types.ts',
    },
    {
      code: "export const A = 1; export const B = ['x', A]; export const C = { a: `${A}` } as const;",
      filename: 'src/m/m.constants.ts',
    },
    {
      code: 'type Local = string; const LOCAL = 1; export function f(x: Local) { return x + LOCAL; }',
      filename: 'src/m/m.service.ts',
    },
    { code: 'export const LIMIT = 1;', filename: 'src/index.ts' }, // no kind: not checked
  ],
  invalid: [
    {
      code: "import { z } from 'zod'; export const s = z.string();",
      filename: 'src/m/m.types.ts',
      errors: [{ messageId: 'valueImportInTypes' }, { messageId: 'valueInTypes' }],
    },
    {
      code: 'export type T = string; export const f = () => 1;',
      filename: 'src/m/m.constants.ts',
      errors: [{ messageId: 'typeInConstants' }, { messageId: 'codeInConstants' }],
    },
    {
      code: 'export type T = string; export const LIMIT = 5; export { type T as U };',
      filename: 'src/m/m.tool.ts',
      errors: [
        { messageId: 'typeInCode' },
        { messageId: 'literalInCode' },
        { messageId: 'typeInCode' },
      ],
    },
  ],
});

ruleTester.run('pure-imports', pureImports, {
  valid: [
    "import path from 'node:path'; import { z } from 'zod';",
    "import type { Stats } from 'node:fs'; import { type Tool } from './x.tool.js';",
    "import { slug } from './x.utils.js'; import { LIMIT } from './x.constants.js';",
    "import { promptSchema } from './x.validator.js';", // a validator is pure too
    "import type { Run } from './x.helper.js';", // types vanish at runtime
  ],
  invalid: [
    { code: "import { readFile } from 'node:fs/promises';", errors: [{ messageId: 'impure' }] },
    { code: "import { spawn } from 'child_process';", errors: [{ messageId: 'impure' }] },
    { code: "import { run } from './x.service.js';", errors: [{ messageId: 'impure' }] },
    { code: "import { type A, b } from './x.adapter.js';", errors: [{ messageId: 'impure' }] },
    { code: "await import('node:os');", errors: [{ messageId: 'impure' }] },
    // A helper does I/O, so neither a utils file nor a validator may import one.
    { code: "import { writeText } from './x.helper.js';", errors: [{ messageId: 'impure' }] },
    {
      code: "import { readFileSync } from 'node:fs';",
      filename: 'src/workbook/workbook.validator.ts',
      errors: [{ messageId: 'impure' }],
    },
  ],
});

ruleTester.run('no-terminal-io', harnessPlugin.rules['no-terminal-io'], {
  valid: [
    "import path from 'node:path'; import { spawn } from 'node:child_process';",
    "import { env } from 'node:process'; const { argv } = process; process.exitCode = 1;",
    "import { readline } from './readline.utils.js';", // a local module, not node's
    'child.stdout.on("data", () => undefined);', // a child process's pipes are data, not the terminal
  ],
  invalid: [
    "import { createInterface } from 'node:readline';",
    "import { createInterface } from 'node:readline/promises';",
    "import readline from 'readline';",
    "import { isatty } from 'node:tty';",
    "await import('node:readline/promises');",
    "process.stdout.write('hi');",
    'if (process.stdin.isTTY) {}',
    "process.stderr.write('oops');",
    "import { stdout } from 'node:process';",
    'const { stdin } = process;',
  ].map((code) => ({ code, errors: 1 })),
});
