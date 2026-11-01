// Shared ESLint config for every @sheavly/harness workspace: strict type-aware TypeScript,
// readability rules that track comprehension cost, the file structure rules, and no inline
// escape hatches. A workspace's
// `eslint.config.js` is `baseConfig({ tsconfigRootDir: import.meta.dirname })`, plus its own
// layer boundaries and exceptions.
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import prettier from 'eslint-config-prettier';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { DEFAULT_MAX_LINES, FILE_KIND_POLICIES, TEST_FOLDER } from './file-kinds.js';
import { harnessPlugin } from './plugin.js';
import { READABILITY_RULES } from './readability.js';
import { TYPESCRIPT_RULES } from './typescript.js';

export const TYPED_FILES = ['**/*.ts'];
export const PLAIN_JS_FILES = ['**/*.js', '**/*.mjs'];
export const TEST_FILES = [`**/${TEST_FOLDER}/**/*.ts`, 'src/testing/**/*.ts'];
/** Where the conventions and structure rules apply: a workspace's own TypeScript source. */
const SOURCE_FILES = ['src/**/*.ts'];
/** Files outside any tsconfig (configs, hooks) that still get type info, from a default project. */
const DEFAULT_PROJECT_FILES = ['*.ts', '*.js', '*.mjs', '.cursor/hooks/*.mjs'];

function maxLines(max) {
  return max === null ? 'off' : ['error', { max, skipBlankLines: true, skipComments: true }];
}

// Large files are where structure gets lost; split by responsibility before adding more.
// One block per kind, read off FILE_KIND_POLICIES, so a new kind brings its own limit.
const maxLinesPerKind = Object.entries(FILE_KIND_POLICIES).map(([kind, policy]) => ({
  files: [`**/*.${kind}.ts`],
  rules: { 'max-lines': maxLines(policy.maxLines) },
}));

/**
 * @param {object} params
 * @param {string} params.tsconfigRootDir The workspace directory: pass `import.meta.dirname`.
 * @param {string[]} [params.entryFiles] Files without a kind (an app's entry points).
 */
export function baseConfig(params) {
  const { tsconfigRootDir, entryFiles = [] } = params;

  return defineConfig([
    globalIgnores(['dist/', 'coverage/', 'node_modules/']),
    {
      // Exceptions live in `files:` overrides with a reason, where review sees them; never in
      // inline `eslint-disable` comments an agent can add to silence a rule.
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    },

    // --- Every file: recommended JS + readability ---
    {
      files: [...TYPED_FILES, ...PLAIN_JS_FILES],
      extends: [js.configs.recommended],
      plugins: { '@stylistic': stylistic, sonarjs, unicorn, harness: harnessPlugin },
      languageOptions: { globals: globals.node },
      rules: {
        ...READABILITY_RULES,
        'no-console': 'error',
        'prefer-const': 'error',
        'object-shorthand': 'error',
        'max-params': ['error', 4],
      },
    },

    // --- TypeScript: strict + stylistic, type-aware ---
    {
      files: TYPED_FILES,
      extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        parserOptions: {
          projectService: { allowDefaultProject: DEFAULT_PROJECT_FILES },
          tsconfigRootDir,
        },
      },
      rules: TYPESCRIPT_RULES,
    },

    // --- Conventions ---
    {
      files: SOURCE_FILES,
      rules: {
        'harness/no-default-export': 'error',
        'harness/no-process-env': 'error',
        'harness/params-object': 'error',
        'harness/no-barrel': 'error',
      },
    },

    // --- Structure: `<name>.<kind>.ts`, each kind exports one shape, utils stay pure ---
    {
      files: SOURCE_FILES,
      ignores: entryFiles,
      rules: { 'harness/file-kind': 'error', 'harness/kind-contents': 'error' },
    },
    { files: TYPED_FILES, rules: { 'max-lines': maxLines(DEFAULT_MAX_LINES) } },
    ...maxLinesPerKind,
    { files: ['src/**/*.utils.ts'], rules: { 'harness/utils-imports': 'error' } },

    // --- Tests: may set env, assert known shapes, and repeat setup by design ---
    {
      files: TEST_FILES,
      rules: {
        'harness/no-process-env': 'off',
        // Local helpers (`sleep(ms)`, `waitFor(check, ms)`) read fine positionally.
        'harness/params-object': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        'max-nested-callbacks': ['error', 4], // describe → it → callback → inner callback
      },
    },

    // --- Plain JS (configs, scripts, hooks): untyped, but still never on deprecated APIs ---
    // The type-aware rule sets stay off (JS has no annotations to check), yet the parser gets
    // type info so `no-deprecated` can see `@deprecated` on Node and library APIs. Loose files
    // (configs, `.cursor/hooks`) use the default project; a package of JS has a tsconfig.
    {
      files: PLAIN_JS_FILES,
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
          projectService: { allowDefaultProject: DEFAULT_PROJECT_FILES },
          tsconfigRootDir,
        },
      },
      plugins: { '@typescript-eslint': tseslint.plugin },
      rules: { '@typescript-eslint/no-deprecated': 'error' },
    },

    // --- Formatting is owned by Prettier (.prettierrc.json); keep ESLint out of it ---
    prettier,
    // Re-applied after eslint-config-prettier, which would otherwise switch `curly` off.
    { files: [...TYPED_FILES, ...PLAIN_JS_FILES], rules: { curly: READABILITY_RULES.curly } },
  ]);
}
