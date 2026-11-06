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

  it('takes `.tsx` for a component and for a test, and for no other kind', ({ expect }) => {
    expect(kindOfFile('src/ink/status-row.component.tsx')).toBe('component');
    expect(kindOfFile('src/ink/__tests__/status-row.component.test.tsx')).toBe('test');
    expect(kindOfFile('src/ink/status-row.component.ts')).toBeNull();
    expect(kindOfFile('src/ink/status-row.service.tsx')).toBeNull();
  });
});

ruleTester.run('file-kind', fileKind, {
  valid: [
    { code: '', filename: 'src/tools/read-file/read-file.tool.ts' },
    { code: '', filename: 'src/tools/read-file/__tests__/read-file.tool.test.ts' },
    { code: '', filename: 'src/ink/status-row.component.tsx' },
    { code: '', filename: 'src/ink/__tests__/status-row.component.test.tsx' },
  ],
  invalid: [
    { code: '', filename: 'src/tools/read-file/readFile.ts', errors: [{ messageId: 'badName' }] },
    // A view is `.tsx`, and nothing else is.
    { code: '', filename: 'src/ink/status-row.component.ts', errors: [{ messageId: 'badName' }] },
    { code: '', filename: 'src/ink/status-row.helper.tsx', errors: [{ messageId: 'badName' }] },
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
      filename: 'src/m/m.helper.ts',
    },
    { code: 'export const LIMIT = 1;', filename: 'src/index.ts' }, // no kind: not checked
    // A service exports a class; it may export functions beside it.
    {
      code: 'export class Tasks { #all = new Map(); } export function idOf() { return 1; }',
      filename: 'src/m/m.service.ts',
    },
    // A validator exports schemas (however the chain is wrapped) and parse functions.
    {
      code: "import { z } from 'zod'; export const aSchema = z.object({ a: z.string() }).strict(); export const bSchema = z.string() as z.ZodString; export function parseA(x: unknown) { return aSchema.parse(x); }",
      filename: 'src/m/m.validator.ts',
    },
    // A schema only its own file uses stays where it is, and so does one inside a definition.
    {
      code: "import { z } from 'zod'; const local = z.string(); export const tool = defineTool({ inputSchema: z.object({ a: local }) });",
      filename: 'src/m/m.tool.ts',
    },
    // A service exporting its class by specifier, or as the default, has its class.
    { code: 'class Tasks {} export { Tasks };', filename: 'src/m/m.service.ts' },
    { code: 'export default class Tasks {}', filename: 'src/m/m.service.ts' },
    // A value that merely uses a schema (parsing with it, reading it) is not a schema, at the
    // top level or inside a function.
    {
      code: "import { z } from 'zod'; const aSchema = z.object({ a: z.string() }); export const parsed = parse(aSchema); export const config = aSchema.parse(raw); export const result = aSchema.safeParse(raw); export const keys = aSchema.shape; export const json = z.toJSONSchema(aSchema); export const info = aSchema.meta(); export function check(x: unknown) { return aSchema.parse(x); }",
      filename: 'src/m/m.utils.ts',
    },
    // A routes file exports the function that builds its group of routes.
    {
      code: "import { Hono } from 'hono'; export function promptRoutes(deps: { send: () => string }) { return new Hono().post('/', (c) => c.text(deps.send())); }",
      filename: 'src/server/prompts.routes.ts',
    },
    // Re-exports from another module are that module's business.
    { code: "export { aSchema } from './m.validator.js';", filename: 'src/m/m.utils.ts' },
    // `zod` as a type only, or another library's `z`, isn't a schema.
    {
      code: "import type { z } from 'zod'; import { z as other } from './other.js'; export const value = other.thing();",
      filename: 'src/m/m.utils.ts',
    },
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
    // Routes hold no state and export no types: those go in services and `*.types.ts`.
    {
      code: 'export class Router {} export type Routes = string;',
      filename: 'src/server/prompts.routes.ts',
      errors: [
        { messageId: 'classInHelper', data: { name: 'Router', kind: 'routes' } },
        { messageId: 'typeInCode' },
      ],
    },
    // A helper is stateless: it exports no class.
    {
      code: 'export class Queue { #items = []; } export function run() { return 1; }',
      filename: 'src/m/m.helper.ts',
      errors: [{ messageId: 'classInHelper', data: { name: 'Queue', kind: 'helper' } }],
    },
    // A service owns state: one with functions only is a helper (or utils) in disguise.
    {
      code: 'export function run() { return 1; } export const other = () => 2;',
      filename: 'src/m/m.service.ts',
      errors: [{ messageId: 'serviceWithoutClass' }],
    },
    // An exported schema anywhere but a validator, under zod's own or another local name.
    {
      code: "import { z } from 'zod'; export const promptSchema = z.object({ text: z.string() });",
      filename: 'src/m/m.utils.ts',
      errors: [
        { messageId: 'schemaOutsideValidator', data: { name: 'promptSchema', kind: 'utils' } },
      ],
    },
    {
      code: "import * as zod from 'zod'; export const envSchema = zod.object({}).strict();",
      filename: 'src/m/m.helper.ts',
      errors: [{ messageId: 'schemaOutsideValidator' }],
    },
    {
      code: "import { z } from 'zod'; export class Store {} export const stateSchema = z.object({});",
      filename: 'src/m/m.service.ts',
      errors: [{ messageId: 'schemaOutsideValidator' }],
    },
    // Specifier exports resolve to what they name: a class or schema exported later, or renamed.
    {
      code: 'class Queue {} export { Queue };',
      filename: 'src/m/m.helper.ts',
      errors: [{ messageId: 'classInHelper', data: { name: 'Queue', kind: 'helper' } }],
    },
    {
      code: "import { z } from 'zod'; const promptSchema = z.object({}); export { promptSchema as prompt };",
      filename: 'src/m/m.utils.ts',
      errors: [{ messageId: 'schemaOutsideValidator', data: { name: 'prompt', kind: 'utils' } }],
    },
    {
      code: 'export const Queue = class {};',
      filename: 'src/m/m.helper.ts',
      errors: [{ messageId: 'classInHelper' }],
    },
    // A schema derived from a local one is a schema too, whatever order they're declared in.
    {
      code: "import { z } from 'zod'; const base = z.object({ a: z.string() }); export const fullSchema = base.extend({ b: z.number() }); export const optionalSchema = fullSchema.optional();",
      filename: 'src/m/m.helper.ts',
      errors: [{ messageId: 'schemaOutsideValidator' }, { messageId: 'schemaOutsideValidator' }],
    },
    {
      code: "import { z } from 'zod'; export const pick = flag ? z.string() : z.number();",
      filename: 'src/m/m.utils.ts',
      errors: [{ messageId: 'schemaOutsideValidator' }],
    },
    // Members that return a schema keep it one: `.meta({...})`, `.keyof()`, `.element`.
    {
      code: "import { z } from 'zod'; const userSchema = z.object({ a: z.string() }); export const tagged = userSchema.meta({ id: 'user' }); export const keys = userSchema.keyof(); export const item = z.array(z.string()).element;",
      filename: 'src/m/m.helper.ts',
      errors: [
        { messageId: 'schemaOutsideValidator' },
        { messageId: 'schemaOutsideValidator' },
        { messageId: 'schemaOutsideValidator' },
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
