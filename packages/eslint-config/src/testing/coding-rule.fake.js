import path from 'node:path';
import { ESLint } from 'eslint';

const REPO = path.resolve(import.meta.dirname, '../../../..');

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
