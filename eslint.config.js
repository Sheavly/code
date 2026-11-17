// ESLint for the root's own files: `scripts/`, `.cursor/hooks/` and the root configs. The shared
// rules live in @sheavly/eslint-config (packages/eslint-config); every workspace in packages/ and
// apps/ is linted with its own config.
//
//   npm run lint            check everything
//   npm run lint:fix        apply auto-fixes, then Prettier
//   npm run format          Prettier owns formatting; ESLint never reports on it
import { baseConfig } from '@sheavly/eslint-config';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // The workbook's projects are what the agent reads and writes, not harness source.
  globalIgnores(['workbook/workspaces/', 'workbook/runs/']),
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // CLIs: they report to the terminal.
  { files: ['.cursor/hooks/**/*.mjs', 'scripts/**/*.mjs'], rules: { 'no-console': 'off' } },
  // The hooks' per-chat state is read and written by `chat-state.utils.mjs` alone; tests point it
  // at a temp folder through the env variable the rule bans elsewhere.
  {
    files: ['.cursor/hooks/**/*.mjs'],
    ignores: ['.cursor/hooks/chat-state.utils.mjs', '.cursor/hooks/__tests__/**'],
    rules: { 'harness/no-adhoc-chat-state': 'error' },
  },
]);
