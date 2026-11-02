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
 * The front ends: the only files that may do terminal I/O (`harness/no-terminal-io`). Everything
 * else is a backend that emits typed events. Keep this list short; a new UI is added here only
 * when its issue asks for one, so review sees it.
 */
const FRONT_END_FILES = ['src/demo.ts', 'src/terminal-ui/**/*.ts', 'src/workbook/**/*.ts'];
/**
 * Hosts read env; the front ends also talk to the terminal; the process runner passes a scrubbed
 * env on. `src/host/` wires a run (no UI); `src/workbook/` is a host with its own CLI.
 */
const HOST_FILES = [
  'src/host/**/*.ts',
  'src/runtime/process/process.helper.ts',
  ...FRONT_END_FILES,
];
/** Hosts' command-line entry points: files without a kind. */
const HOST_ENTRIES = ['src/demo.ts', 'src/workbook/workbook.ts'];
/** The package entry (`main`): the one file that re-exports. */
const ENTRY_FILE = 'src/index.ts';

// --- Layers: imports only point "down": @sheavly/core ← @sheavly/providers, runtime ← tools ← loop ← hosts ---
// Providers are their own package (packages/providers): its `rootDir` makes an import of the app a
// type error, so it needs no entry here. Only the hosts and the entry may import it (below).

const LAYERS = [
  {
    files: ['src/runtime/**/*.ts'],
    forbidden: [
      '**/loop/**',
      '**/tools/**',
      '**/providers/**',
      '**/host/**',
      '**/terminal-ui/**',
      '**/workbook/**',
      '**/demo.js',
    ],
    message:
      'Runtime services (workspace, processes, tasks) must not depend on the loop, tools or providers.',
  },
  {
    files: ['src/tools/**/*.ts'],
    forbidden: [
      '**/loop/**',
      '**/providers/**',
      '**/host/**',
      '**/terminal-ui/**',
      '**/workbook/**',
      '**/demo.js',
    ],
    message: 'Tools must not depend on the loop or on providers; take what they need as options.',
  },
  {
    files: ['src/loop/**/*.ts'],
    forbidden: [
      '**/providers/**',
      '**/tools/**',
      '**/host/**',
      '**/terminal-ui/**',
      '**/workbook/**',
      '**/demo.js',
    ],
    message:
      'The loop knows the Provider and Tool contracts (@sheavly/core) only, never concrete providers or tools.',
  },
  {
    files: ['src/host/**/*.ts'],
    forbidden: ['**/terminal-ui/**', '**/workbook/**', '**/demo.js'],
    message:
      'The host wires a run and has no UI: it must not depend on a front end (terminal-ui, workbook, demo).',
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
    frontEndFiles: FRONT_END_FILES,
  }),
  ...layerBlocks,
  { files: [ENTRY_FILE], rules: { 'harness/no-barrel': 'off' } },
  { files: HOST_FILES, rules: { 'harness/no-process-env': 'off' } },
  { files: FRONT_END_FILES, rules: { 'no-console': 'off' } },
  // CLIs: they report to the terminal.
  { files: ['.cursor/hooks/**/*.mjs', 'scripts/**/*.mjs'], rules: { 'no-console': 'off' } },
]);
