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
      'harness/guard-working-root': 'error',
    },
  },
  // The agent's file tools write a project through the filesystem effects in this one helper,
  // which `Workspace` has confined; the user's own data is `@sheavly/storage`'s
  // (`harness/no-direct-file-writes`). A tool calls it rather than importing `node:fs` itself.
  {
    files: ['src/files/file-effects.helper.ts'],
    rules: { 'harness/no-direct-file-writes': 'off' },
  },
  // The guarded resolvers are the one place `Workspace.resolveWrite` / `resolveDelete` are called,
  // with the `.env` and `.git` guards on both sides (`harness/guard-env-write`).
  {
    files: ['src/files/files.helper.ts'],
    rules: { 'harness/guard-env-write': 'off' },
  },
]);
