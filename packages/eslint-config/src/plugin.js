import { fileKind } from './rules/file-kind.js';
import { brandedIds } from './rules/branded-ids.js';
import { guardEnvRead } from './rules/guard-env-read.js';
import { guardEnvWrite } from './rules/guard-env-write.js';
import { guardSearchRoot } from './rules/guard-search-root.js';
import { importsRule } from './rules/imports.js';
import { kindContents } from './rules/kind-contents.js';
import { layoutRule } from './rules/layout.js';
import { noBrandCast } from './rules/no-brand-cast.js';
import { noRawError } from './rules/no-raw-error.js';
import { noSilentCatch } from './rules/no-silent-catch.js';
import { permissionStoreRoot } from './rules/permission-store-root.js';
import { SYNTAX_RULES, syntaxRule } from './rules/syntax-rules.js';
import { pureImports } from './rules/pure-imports.js';
import { singleDefinition } from './rules/single-definition.js';

/** The `harness/*` rules. */
export const harnessPlugin = {
  meta: { name: 'harness' },
  rules: {
    'branded-ids': brandedIds,
    'file-kind': fileKind,
    'guard-env-read': guardEnvRead,
    'guard-env-write': guardEnvWrite,
    'guard-search-root': guardSearchRoot,
    imports: importsRule,
    'kind-contents': kindContents,
    layout: layoutRule,
    'no-brand-cast': noBrandCast,
    'no-raw-error': noRawError,
    'no-silent-catch': noSilentCatch,
    'permission-store-root': permissionStoreRoot,
    'pure-imports': pureImports,
    'single-definition': singleDefinition,
    ...Object.fromEntries(
      Object.entries(SYNTAX_RULES).map(([name, entries]) => [name, syntaxRule(entries)]),
    ),
  },
};
