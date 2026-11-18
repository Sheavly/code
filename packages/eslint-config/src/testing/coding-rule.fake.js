import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { harnessPlugin } from '../plugin.js';

const REPO = path.resolve(import.meta.dirname, '../../../..');

/** An ESLint over this repo that runs only `rule`, on every `.ts` file, to lint real sources. */
export function repoRuleLinter(rule) {
  return new ESLint({
    cwd: REPO,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser, parserOptions: { tsconfigRootDir: REPO } },
        plugins: { harness: harnessPlugin },
        rules: { [rule]: 'error' },
      },
    ],
  });
}

/**
 * True if `rule` (e.g. `harness/guard-env-read`) is an error for `file` of the coding package, or
 * of another workspace named by `folder` (e.g. `apps/backend`).
 */
export async function ruleIsErrorOn(params) {
  const { rule, file, folder = 'extensions/coding' } = params;
  const cwd = path.join(REPO, folder);
  const config = await new ESLint({ cwd }).calculateConfigForFile(path.join(cwd, file));
  const entry = config?.rules[rule];
  const severity = Array.isArray(entry) ? entry[0] : entry;

  return severity === 2 || severity === 'error';
}
