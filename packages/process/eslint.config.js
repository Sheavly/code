import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // A command's deadline is `withDeadline`'s: the process folder sets no timer of its own.
  {
    files: ['src/process/**/*.ts'],
    ignores: ['src/process/**/__tests__/**'],
    rules: { 'harness/no-adhoc-command-deadline': 'error' },
  },
  // The one place the deadline is made.
  {
    files: ['src/process/deadline.helper.ts'],
    rules: { 'harness/no-adhoc-command-deadline': 'off' },
  },
]);
