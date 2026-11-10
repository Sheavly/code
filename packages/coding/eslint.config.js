import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // A tool, or the helper it moves a read into, that resolves a path for reading must refuse
  // `.env` files around it. Every source file of this package, so splitting a tool in two
  // cannot take the read out of the rule's reach.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**', 'src/testing/**'],
    rules: { 'harness/guard-env-read': 'error' },
  },
  // The agent's file tools write a project. They do it through `Workspace` (confined to its root),
  // under a file lock and the allow list, which is what makes a write by the agent safe; the
  // user's own data is `@sheavly/storage`'s (`harness/no-direct-file-writes`).
  {
    files: ['src/files/files.helper.ts', 'src/write-file/write-file.tool.ts'],
    rules: { 'harness/no-direct-file-writes': 'off' },
  },
]);
