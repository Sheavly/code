// ESLint for the harness app. The shared rules live in @sheavly/eslint-config
// (packages/eslint-config); this file adds what is specific to the app: its entry points and
// hosts. Its layer boundaries are in the shared layout.
//
//   npm run lint            check everything (each package is linted with its own config)
//   npm run lint:fix        apply auto-fixes, then Prettier
//   npm run format          Prettier owns formatting; ESLint never reports on it
import { baseConfig } from '@sheavly/eslint-config';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * The front ends: the only files that may do terminal I/O (`harness/no-terminal-io`). Everything
 * else is a backend that emits typed events. Keep this list short; a new UI is added here only
 * when its issue asks for one, so review sees it.
 */
const FRONT_END_FILES = ['src/demo.ts'];
/** Hosts' command-line entry points: files without a kind. */
const HOST_ENTRIES = ['src/demo.ts'];
/** The package entry (`main`): the one file that re-exports. */
const ENTRY_FILE = 'src/index.ts';

// Layers and the workspace graph live in the shared layout (packages/eslint-config/src/layout.js):
// `harness/imports` holds every workspace, and this app's src/ folders until #29 splits it.

export default defineConfig([
  // The workbook's projects are what the agent reads and writes, not harness source.
  globalIgnores(['workbook/workspaces/', 'workbook/runs/']),
  ...baseConfig({
    tsconfigRootDir: import.meta.dirname,
    entryFiles: [ENTRY_FILE, ...HOST_ENTRIES],
    frontEndFiles: FRONT_END_FILES,
  }),
  { files: [ENTRY_FILE], rules: { 'harness/no-barrel': 'off' } },
  // The front end is a host: the demo reads env.
  { files: FRONT_END_FILES, rules: { 'harness/no-process-env': 'off' } },
  { files: FRONT_END_FILES, rules: { 'no-console': 'off' } },
  // CLIs: they report to the terminal.
  { files: ['.cursor/hooks/**/*.mjs', 'scripts/**/*.mjs'], rules: { 'no-console': 'off' } },
]);
