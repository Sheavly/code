import path from 'node:path';
import { ESLint } from 'eslint';

const CODING = path.resolve(import.meta.dirname, '../../../coding');

/** True if `rule` (e.g. `harness/guard-env-read`) is an error for `file` of the coding package. */
export async function ruleIsErrorOn(params) {
  const { rule, file } = params;
  const config = await new ESLint({ cwd: CODING }).calculateConfigForFile(path.join(CODING, file));
  const entry = config?.rules[rule];
  const severity = Array.isArray(entry) ? entry[0] : entry;

  return severity === 2 || severity === 'error';
}
