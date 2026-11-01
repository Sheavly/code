// ESLint for the harness app. The shared rules live in @sheavly/eslint-config
// (packages/eslint-config); this file adds what is specific to the app: its layer boundaries,
// entry points and hosts.
//
//   npm run lint            check everything (each package is linted with its own config)
//   npm run lint:fix        apply auto-fixes, then Prettier
//   npm run format          Prettier owns formatting; ESLint never reports on it
import { baseConfig, TEST_FILES } from '@sheavly/eslint-config';
import { defineConfig } from 'eslint/config';

/** Hosts talk to the terminal and read env; the process runner passes a scrubbed env on. */
const HOST_FILES = ['src/demo.ts', 'src/runtime/process/process.service.ts'];
/** The package entry (`main`): the one file that re-exports. */
const ENTRY_FILE = 'src/index.ts';

// --- Layers: imports only point "down": @sheavly/core ← providers, runtime ← tools ← loop ← hosts ---

const LAYERS = [
  {
    files: ['src/providers/**/*.ts'],
    forbidden: ['**/loop/**', '**/tools/**', '**/runtime/**', '**/demo.js'],
    message: 'Providers only depend on core: they must not know about the loop, tools or runtime.',
  },
  {
    files: ['src/runtime/**/*.ts'],
    forbidden: ['**/loop/**', '**/tools/**', '**/providers/**', '**/demo.js'],
    message:
      'Runtime services (workspace, processes, tasks) must not depend on the loop, tools or providers.',
  },
  {
    files: ['src/tools/**/*.ts'],
    forbidden: ['**/loop/**', '**/providers/**', '**/demo.js'],
    message: 'Tools must not depend on the loop or on providers; take what they need as options.',
  },
  {
    files: ['src/loop/**/*.ts'],
    forbidden: ['**/providers/**', '**/tools/**', '**/demo.js'],
    message:
      'The loop knows the Provider and Tool contracts (@sheavly/core) only, never concrete providers or tools.',
  },
];

const layerBlocks = LAYERS.map(({ files, forbidden, message }) => ({
  files,
  ignores: TEST_FILES, // tests wire concrete pieces together on purpose
  rules: { 'no-restricted-imports': ['error', { patterns: [{ group: forbidden, message }] }] },
}));

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname, entryFiles: [ENTRY_FILE, 'src/demo.ts'] }),
  ...layerBlocks,
  { files: [ENTRY_FILE], rules: { 'harness/no-barrel': 'off' } },
  { files: HOST_FILES, rules: { 'harness/no-process-env': 'off', 'no-console': 'off' } },
  { files: ['.cursor/hooks/**/*.mjs'], rules: { 'no-console': 'off' } },
]);
