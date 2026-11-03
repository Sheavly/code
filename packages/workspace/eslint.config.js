import { baseConfig } from '@sheavly/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // The process runner hands each command a scrubbed copy of the environment (no API keys), so it
  // reads `process.env` once, to build that copy. Nothing else here reads env.
  { files: ['src/process/process.service.ts'], rules: { 'harness/no-process-env': 'off' } },
]);
