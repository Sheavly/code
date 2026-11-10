import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // A tool, or the helper it moves a read into, that resolves a path for reading must refuse
  // `.env` files around it. Every source file of this package, so splitting a tool in two
  // cannot take the read out of the rule's reach. A path resolved for a write or a delete goes
  // through `files.helper.ts` (which refuses `.env` and `.git` on both sides), never
  // `Workspace.resolveWrite` / `resolveDelete` directly.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**', 'src/testing/**'],
    rules: {
      'harness/guard-env-read': 'error',
      'harness/guard-env-write': 'error',
      'harness/guard-search-root': 'error',
    },
  },
  // The agent's file tools write a project. They do it through `Workspace` (confined to its root),
  // under a file lock and the allow list, which is what makes a write by the agent safe; the
  // user's own data is `@sheavly/storage`'s (`harness/no-direct-file-writes`). Only this helper
  // changes the project's files and resolves their paths: a tool calls it rather than importing
  // `node:fs` or `Workspace`'s unguarded resolvers itself.
  {
    files: ['src/files/files.helper.ts'],
    rules: {
      'harness/guard-env-write': 'off',
      'harness/no-direct-file-writes': 'off',
    },
  },
]);
