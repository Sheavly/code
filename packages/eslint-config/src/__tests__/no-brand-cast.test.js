import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';

// `no-brand-cast` is type-aware, so it lints real files of a temp project with a tsconfig. The
// brand is declared the way zod declares it: a `unique symbol` property on an intersection.
const dir = mkdtempSync(path.join(tmpdir(), 'no-brand-cast-'));
const BRAND = [
  'declare const $brand: unique symbol;',
  'type SessionId = string & { [$brand]: { SessionId: true } };',
  'type Plain = string;',
  'declare function parse(value: unknown): SessionId;',
].join('\n');

writeFileSync(
  path.join(dir, 'tsconfig.json'),
  JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['*.ts'] }),
);

const eslint = new ESLint({
  cwd: dir,
  overrideConfigFile: true,
  overrideConfig: {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: dir },
    },
    plugins: { harness: harnessPlugin },
    rules: { 'harness/no-brand-cast': 'error' },
  },
});

async function castsIn(name, code) {
  const file = path.join(dir, `${name}.ts`);

  writeFileSync(file, `${BRAND}\n${code}\n`);
  const [result] = await eslint.lintFiles([file]);

  return result.messages.map((message) => message.ruleId);
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('no-brand-cast', () => {
  it('lets a branded value be parsed, and other types be asserted', async () => {
    expect(
      await castsIn(
        'valid',
        "export const id = parse('s1');\nexport const plain = 'x' as Plain;\nexport const s = id as string;",
      ),
    ).toEqual([]);
  });

  it('refuses asserting a branded type, directly or in a union', async () => {
    expect(
      await castsIn(
        'invalid',
        "export const a = 's1' as SessionId;\nexport const b = (undefined as unknown) as SessionId | undefined;",
      ),
    ).toEqual(['harness/no-brand-cast', 'harness/no-brand-cast']);
  });
});
