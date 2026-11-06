import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // The agent's file tools write a project. They do it through `Workspace` (confined to its root),
  // under a file lock and the allow list, which is what makes a write by the agent safe; the
  // user's own data is `@sheavly/storage`'s (`harness/no-direct-file-writes`).
  {
    files: ['src/files/files.helper.ts', 'src/write-file/write-file.tool.ts'],
    rules: { 'harness/no-direct-file-writes': 'off' },
  },
]);
