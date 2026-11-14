// Test-only: a temp TypeScript project and an ESLint that runs one `harness/*` rule on its files,
// for type-aware rules, which need real files and a tsconfig.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { harnessPlugin } from '../plugin.js';

/**
 * A project in a temp folder with `files` (path to text) and the tsconfig `options`, an ESLint
 * running only `rule`, `lint({ file, code })` (the rule ids it reports) and `remove()`.
 */
export function typedProject(params) {
  const { name, rule, files = {}, include, options = {} } = params;
  const dir = mkdtempSync(path.join(tmpdir(), `${name}-`));
  const write = (file, code) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), code);
  };

  write(
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, ...options }, include }),
  );
  Object.entries(files).forEach(([file, code]) => write(file, code));

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
      rules: { [rule]: 'error' },
    },
  });

  return {
    write,
    async lint({ file, code }) {
      write(file, code);
      const [result] = await eslint.lintFiles([path.join(dir, file)]);

      return result.messages.map((message) => message.ruleId);
    },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
