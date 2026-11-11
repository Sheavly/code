// Test-only: ESLint's RuleTester wired to Vitest, so a rule test file is its cases.
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

/**
 * A `RuleTester` that parses TypeScript. `languageOptions` are added to its own, e.g.
 * `{ sourceType: 'module' }` for a rule about imports.
 */
export function typescriptRuleTester(languageOptions = {}) {
  const { parserOptions, ...options } = languageOptions;

  // RuleTester reuses filenames with different source text. CI's immutable single-run programs
  // cannot represent those edits, so these tests need the parser's mutable program path.
  return new RuleTester({
    languageOptions: {
      parser: tseslint.parser,
      ...options,
      parserOptions: { ...parserOptions, disallowAutomaticSingleRunInference: true },
    },
  });
}
