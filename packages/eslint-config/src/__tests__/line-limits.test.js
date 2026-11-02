import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { baseConfig } from '../base.js';
import { FILE_KIND_POLICIES } from '../file-kinds.js';

// The line limits as ESLint actually applies them, not just as file-kinds.js declares them: a
// later block in base.js could otherwise put a cap back on a kind that has none.
const eslint = new ESLint({
  cwd: import.meta.dirname,
  overrideConfigFile: true,
  overrideConfig: baseConfig({ tsconfigRootDir: path.resolve(import.meta.dirname, '../..') }),
});

/** The `max-lines` setting for `file`: `undefined` when the rule is off. */
async function maxLinesFor(file) {
  const config = await eslint.calculateConfigForFile(path.join(import.meta.dirname, file));
  const [severity, options] = config.rules['max-lines'] ?? [0];

  return severity === 0 ? undefined : options.max;
}

describe('line limits', () => {
  it('puts no cap on utils files: pure helpers grow with their subject', async () => {
    expect(FILE_KIND_POLICIES.utils.maxLines).toBeNull();
    expect(await maxLinesFor('src/workbook/check.utils.ts')).toBeUndefined();
    expect(await maxLinesFor('packages/core/src/hook/hook.utils.ts')).toBeUndefined();
  });

  it.each(Object.entries(FILE_KIND_POLICIES).filter(([, policy]) => policy.maxLines !== null))(
    'caps %s files at their policy',
    async (kind, policy) => {
      const file = kind === 'test' ? `src/x/__tests__/x.${kind}.ts` : `src/x/x.${kind}.ts`;

      expect(await maxLinesFor(file)).toBe(policy.maxLines);
    },
  );
});
