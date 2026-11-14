import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Linter, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { tempWorkspace, writeFiles } from '../testing/workspace.fake.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const rule = harnessPlugin.rules['single-definition'];
const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

/** A workspace on disk: an app at the root (`src/`) and packages in `packages/*`. */
const workspace = (files) =>
  tempWorkspace({ 'package.json': { name: '@x/app', workspaces: ['packages/*'] }, ...files });
const write = (root, files) => writeFiles({ root, files });

const root = workspace({
  'src/tools/tools.types.ts': 'export type Write = (text: string) => void;\n',
  'src/loop/loop.types.ts': 'export type Turn = number;\n',
  'packages/proto/package.json': { name: '@x/proto', scripts: { schema: 'write-schema' } },
  'packages/proto/src/message/message.types.ts':
    "import type { z } from 'zod';\nexport type Message = z.infer<typeof messageSchema>;\ntype Local = string;\nexport type { Local as ToolCall };\n",
  'packages/proto/src/message/message.validator.ts': 'export const messageSchema = 1;\n',
  'packages/proto/src/message/__tests__/fixtures.types.ts': 'export type Fixture = string;\n',
  'packages/core/package.json': { name: '@x/core' },
  'packages/core/src/tool/tool.types.ts': 'export interface Tool { name: string }\n',
  'packages/notes/README.md': 'not a package: no package.json',
});
const at = (file) => path.join(root, file);
const LOOP = at('src/loop/stream.helper.ts');
const options = [{ root }];

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

ruleTester.run('single-definition', rule, {
  valid: [
    // A name nobody owns, and imports or re-exports from the owner itself.
    { code: "export type StopReason = 'end_turn';", filename: LOOP },
    { code: "export type { Message } from '@x/proto/message/message.types';", filename: LOOP },
    { code: "export type * from '@x/proto/message/message.types';", filename: LOOP },
    { code: "export type { Write } from '../tools/tools.types.js';", filename: LOOP },
    {
      code: "import type { Write } from '../tools/tools.types.js'; export type Sink = Write;",
      filename: LOOP,
    },
    // Library re-exports are not ours to check.
    { code: "export type { ZodType } from 'zod';", filename: LOOP },
    // Test types own nothing.
    { code: 'export type Fixture = number;', filename: LOOP },
    // The owner declares it.
    {
      code: 'export type Message = {};',
      filename: at('packages/proto/src/message/message.types.ts'),
    },
    { code: 'export type Write = () => void;', filename: at('src/tools/tools.types.ts') },
  ].map((test) => ({ ...test, options })),
  invalid: [
    // Another package's type, declared in the app.
    { code: 'export type Message = { role: string };', filename: LOOP },
    { code: 'export interface ToolCall { id: string }', filename: LOOP },
    // One package copying another's.
    { code: 'export type Tool = {};', filename: at('packages/proto/src/tool/tool.types.ts') },
    // Between two app folders (tools and loop).
    { code: 'export type Write = (text: string) => void;', filename: LOOP },
    // An unexported local copy is a copy too.
    { code: 'type Write = (text: string) => void;', filename: LOOP },
    { code: 'type Message = {}; export type { Message };', filename: LOOP },
    // Inside one package: a second file of the same package exporting the same name.
    {
      code: 'export type Message = {};',
      filename: at('packages/proto/src/session/session.types.ts'),
    },
  ]
    .map((test) => ({ ...test, errors: [{ messageId: 'copy' }] }))
    .concat([
      // Re-exported from a file that isn't the owner (a star export is tested below).
      {
        code: "export type { Write } from './stream.types.js';",
        filename: LOOP,
        errors: [{ messageId: 'reexport' }],
      },
    ])
    .map((test) => ({ ...test, options })),
});

function lint(params) {
  const { cwd, code, filename } = params;
  const config = {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { harness: harnessPlugin },
    rules: { 'harness/single-definition': 'error' },
  };

  return new Linter({ cwd }).verify(code, [config], filename).map((problem) => problem.message);
}

describe('single-definition', () => {
  it('says where the original is, how to import it and that its schema is what to change', () => {
    const [message] = lint({ cwd: root, code: 'export type Message = {};', filename: LOOP });

    expect(message).toContain(
      "`Message` is already defined in @x/proto's `src/message/message.types.ts`",
    );
    expect(message).toContain("from '@x/proto/message/message.types'");
    expect(message).toContain(
      '`src/message/message.validator.ts`, then `npm run schema -w @x/proto`',
    );
    expect(message).toContain('sheavly/principles.md');
  });

  it('imports by relative path inside the same workspace, and names the types file without a schema', () => {
    const [message] = lint({ cwd: root, code: 'type Write = () => void;', filename: LOOP });

    expect(message).toContain("from '../tools/tools.types.js'");
    expect(message).toContain('change it in `src/tools/tools.types.ts`');
  });

  it('flags both of two files in one package that export the same type name', () => {
    const files = {
      'packages/twins/package.json': { name: '@x/twins' },
      'packages/twins/src/a/a.types.ts': 'export type Twin = string;\n',
      'packages/twins/src/b/b.types.ts': 'export type Twin = number;\n',
    };
    const twins = workspace(files);

    for (const file of ['packages/twins/src/a/a.types.ts', 'packages/twins/src/b/b.types.ts']) {
      expect(lint({ cwd: twins, code: files[file], filename: path.join(twins, file) })).toEqual([
        expect.stringContaining('`Twin` is already defined in @x/twins'),
      ]);
    }
  });

  it('flags a star re-export of a file that copies an owned type', () => {
    write(root, { 'src/loop/stream.types.ts': 'export type Write = () => void;\n' });

    const messages = lint({
      cwd: root,
      code: "export type * from './stream.types.js';",
      filename: at('src/loop/index.ts'),
    });

    expect(messages).toEqual([expect.stringContaining('re-exports it from another file')]);
  });

  it('covers a package, a folder and a type added after the rule was written, with no change to it', () => {
    const code = 'export type Brand = string;';

    expect(lint({ cwd: root, code, filename: LOOP })).toEqual([]);

    write(root, {
      'packages/brand/package.json': { name: '@x/brand' },
      'packages/brand/src/brand/brand.types.ts': 'export type Brand = string;\n',
    });

    expect(lint({ cwd: root, code, filename: LOOP })).toEqual([
      expect.stringContaining("`Brand` is already defined in @x/brand's"),
    ]);
  });

  it("finds this repo's workspace and reads the real packages' types", () => {
    const [message] = lint({
      cwd: REPO_ROOT,
      code: 'export type AgentEvent = {};',
      filename: path.join(REPO_ROOT, 'src/loop/events/events.types.ts'),
    });

    expect(message).toContain('@sheavly/protocol');
    expect(message).toContain('npm run schema -w @sheavly/protocol');
  });

  it('fails, rather than skip, when there is no workspace root', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'no-workspace-'));

    expect(
      lint({ cwd, code: 'export type X = 1;', filename: path.join(cwd, 'x.types.ts') }),
    ).toEqual([expect.stringContaining('could not find the workspace root')]);
  });
});
