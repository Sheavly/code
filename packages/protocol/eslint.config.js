import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // The list of error codes defines `unknown_approval`; it does not match it.
  {
    files: ['src/server/server.validator.ts'],
    rules: { 'harness/no-adhoc-unknown-approval': 'off' },
  },
]);
