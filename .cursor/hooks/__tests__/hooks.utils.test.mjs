import { describe, expect, it } from 'vitest';
import { formatTurboReport } from '../hooks.utils.mjs';

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
