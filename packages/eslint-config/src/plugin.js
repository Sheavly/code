import { fileKind } from './rules/file-kind.js';
import { kindContents } from './rules/kind-contents.js';
import { noRawError } from './rules/no-raw-error.js';
import { noSilentCatch } from './rules/no-silent-catch.js';
import { SYNTAX_RULES, syntaxRule } from './rules/syntax-rules.js';
import { pureImports } from './rules/pure-imports.js';
import { singleDefinition } from './rules/single-definition.js';

/** The `harness/*` rules. */
export const harnessPlugin = {
  meta: { name: 'harness' },
  rules: {
    'file-kind': fileKind,
    'kind-contents': kindContents,
    'no-raw-error': noRawError,
    'no-silent-catch': noSilentCatch,
    'pure-imports': pureImports,
    'single-definition': singleDefinition,
    ...Object.fromEntries(
      Object.entries(SYNTAX_RULES).map(([name, entries]) => [name, syntaxRule(entries)]),
    ),
  },
};
