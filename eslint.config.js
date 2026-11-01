// ESLint for the harness app. The shared rules live in @sheavly/eslint-config
// (packages/eslint-config); this file adds what is specific to the app: its layer boundaries,
// entry points and hosts.
//
//   npm run lint            check everything (each package is linted with its own config)
//   npm run lint:fix        apply auto-fixes, then Prettier
//   npm run format          Prettier owns formatting; ESLint never reports on it
import { baseConfig, TEST_FILES } from '@sheavly/eslint-config';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * Hosts talk to the terminal and read env; the process runner passes a scrubbed env on.
 * `src/host/` is what every host shares (wiring, the terminal UI); `src/workbook/` is a host.
 */
const HOST_FILES = [
  'src/demo.ts',
  'src/host/**/*.ts',
  'src/workbook/**/*.ts',
  'src/runtime/process/process.service.ts',
];
/** Hosts' command-line entry points: files without a kind. */
const HOST_ENTRIES = ['src/demo.ts', 'src/workbook/workbook.ts'];
/** The package entry (`main`): the one file that re-exports. */
const ENTRY_FILE = 'src/index.ts';

// --- Layers: imports only point "down": @sheavly/core ← providers, runtime ← tools ← loop ← hosts ---

const LAYERS = [
  {
    files: ['src/providers/**/*.ts'],
    forbidden: [
      '**/loop/**',
      '**/tools/**',
      '**/runtime/**',
      '**/host/**',
      '**/workbook/**',
      '**/demo.js',
    ],
    message: 'Providers only depend on core: they must not know about the loop, tools or runtime.',
  },
  {
    files: ['src/runtime/**/*.ts'],
    forbidden: [
      '**/loop/**',
      '**/tools/**',
      '**/providers/**',
      '**/host/**',
      '**/workbook/**',
      '**/demo.js',
    ],
    message:
      'Runtime services (workspace, processes, tasks) must not depend on the loop, tools or providers.',
  },
  {
    files: ['src/tools/**/*.ts'],
    forbidden: ['**/loop/**', '**/providers/**', '**/host/**', '**/workbook/**', '**/demo.js'],
    message: 'Tools must not depend on the loop or on providers; take what they need as options.',
  },
  {
    files: ['src/loop/**/*.ts'],
    forbidden: ['**/providers/**', '**/tools/**', '**/host/**', '**/workbook/**', '**/demo.js'],
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
  // The workbook's projects are what the agent reads and writes, not harness source.
  globalIgnores(['workbook/workspaces/', 'workbook/runs/']),
  ...baseConfig({
    tsconfigRootDir: import.meta.dirname,
    entryFiles: [ENTRY_FILE, ...HOST_ENTRIES],
  }),
  ...layerBlocks,
  { files: [ENTRY_FILE], rules: { 'harness/no-barrel': 'off' } },
  { files: HOST_FILES, rules: { 'harness/no-process-env': 'off', 'no-console': 'off' } },
  { files: ['.cursor/hooks/**/*.mjs'], rules: { 'no-console': 'off' } },
]);
