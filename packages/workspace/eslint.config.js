import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // The scratch folder is not user data: only `src/scratch/` creates it (mode 0700, owner
  // checked) and prunes stale entries from it. `Workspace` calls it and writes nothing itself
  // (`harness/no-direct-file-writes`).
  {
    files: ['src/scratch/scratch-root.helper.ts', 'src/scratch/scratch.helper.ts'],
    rules: { 'harness/no-direct-file-writes': 'off' },
  },
]);
