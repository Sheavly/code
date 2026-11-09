import path from 'node:path';
import { RULE_HINTS } from '../../packages/eslint-config/src/rule-hints.js';
import { PROJECT_ROOT } from './hooks.utils.mjs';

/** ESLint diagnostics with the project's actionable rule hints, loaded only by quality hooks. */
export function formatEslintReport(json) {
  const lines = [];

  for (const file of JSON.parse(json)) {
    const relative = path.relative(PROJECT_ROOT, file.filePath);

    for (const { line, column, message, ruleId } of file.messages) {
      const problem = `${relative}:${line}:${column}  ${message}  (${ruleId ?? 'parse error'})`;
      const hint = ruleId && RULE_HINTS[ruleId];

      lines.push(hint ? `${problem}\n  → ${hint}` : problem);
    }
  }

  return lines;
}
