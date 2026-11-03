import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatEslintReport, formatTurboReport, PROJECT_ROOT } from '../hooks.utils.mjs';

describe('formatEslintReport', () => {
  const report = (ruleId) =>
    JSON.stringify([
      {
        filePath: path.join(PROJECT_ROOT, 'src/a.ts'),
        messages: [{ line: 3, column: 5, message: 'Too deep.', ruleId }],
      },
    ]);

  it("adds the rule's hint under a problem from a rule that has one", () => {
    const [problem] = formatEslintReport(report('max-depth'));

    expect(problem).toMatch(/^src\/a\.ts:3:5 {2}Too deep\. {2}\(max-depth\)\n {2}→ Flatten/);
  });

  it('reports a rule without a hint, and a parse error, on one line', () => {
    expect(formatEslintReport(report('eqeqeq'))).toEqual(['src/a.ts:3:5  Too deep.  (eqeqeq)']);
    expect(formatEslintReport(report(null))).toEqual(['src/a.ts:3:5  Too deep.  (parse error)']);
  });
});

// Shaped like `turbo run … --continue --output-logs=errors-only` with a failing typecheck.
const FAILED_RUN = [
  '',
  '   • turbo 2.11.10',
  '   • Running typecheck, typecheck:root in 4 packages',
  '',
  '@sheavly/core:typecheck: cache miss, executing dcc3ee5c8d6f8a66',
  '@sheavly/core:typecheck: npm notice run tsc --noEmit',
  "@sheavly/core:typecheck: src/a.ts(1,14): error TS2322: Type 'string' is not assignable.",
  '@sheavly/core:typecheck: npm error Lifecycle script `typecheck` failed with error:',
  '@sheavly/core:typecheck: ',
  '@sheavly/core#typecheck:  WARNING  command finished with error, but continuing...',
  '//:typecheck:root: src/b.ts(2,1): error TS2304: Cannot find name x.',
  '//#typecheck:root:  WARNING  command finished with error, but continuing...',
  '@sheavly/core#typecheck:  ERROR  command (/repo/packages/core) npm run typecheck exited (2)',
  '',
  ' Tasks:    2 successful, 4 total',
  'Failed:    //#typecheck:root, @sheavly/core#typecheck',
  '',
  ' ERROR  run failed: command  exited (2)',
].join('\n');

describe('formatTurboReport', () => {
  it("keeps the failing tasks' own output and the Failed: line", () => {
    expect(formatTurboReport(FAILED_RUN).split('\n')).toEqual([
      "@sheavly/core:typecheck: src/a.ts(1,14): error TS2322: Type 'string' is not assignable.",
      '//:typecheck:root: src/b.ts(2,1): error TS2304: Cannot find name x.',
      'Failed:    //#typecheck:root, @sheavly/core#typecheck',
    ]);
  });

  it('strips colors before matching', () => {
    expect(formatTurboReport('\u001B[31m@sheavly/core:lint: 1:1  error  x\u001B[0m')).toBe(
      '@sheavly/core:lint: 1:1  error  x',
    );
  });

  it('returns the whole output when turbo failed before any task ran', () => {
    const output = '  x Could not resolve workspaces.\n  `-> Missing `packageManager` field';

    expect(formatTurboReport(output)).toBe(output);
  });
});
