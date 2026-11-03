// ESLint for the root: what is left of the app (its `src/index.ts` barrel), `scripts/`,
// `.cursor/hooks/` and the root configs. The shared rules live in @sheavly/eslint-config
// (packages/eslint-config); the front ends are apps in apps/, each with its own config.
//
//   npm run lint            check everything (each package is linted with its own config)
//   npm run lint:fix        apply auto-fixes, then Prettier
//   npm run format          Prettier owns formatting; ESLint never reports on it
import { baseConfig } from '@sheavly/eslint-config';
import { defineConfig, globalIgnores } from 'eslint/config';

/** The package entry (`main`): the one file that re-exports. */
const ENTRY_FILE = 'src/index.ts';

// Layers and the workspace graph live in the shared layout (packages/eslint-config/src/layout.js):
// `harness/imports` holds every workspace, and this app's src/ folders until #29 splits it.

export default defineConfig([
  // The workbook's projects are what the agent reads and writes, not harness source.
  globalIgnores(['workbook/workspaces/', 'workbook/runs/']),
  ...baseConfig({
    tsconfigRootDir: import.meta.dirname,
    entryFiles: [ENTRY_FILE],
  }),
  { files: [ENTRY_FILE], rules: { 'harness/no-barrel': 'off' } },
  // CLIs: they report to the terminal.
  { files: ['.cursor/hooks/**/*.mjs', 'scripts/**/*.mjs'], rules: { 'no-console': 'off' } },
]);
