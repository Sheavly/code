import { baseConfig } from '@sheavly/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // `providerFromEnv` is where a host reads the model's settings from the environment (and
  // `.env`); every app calls it instead of reading env itself. Nothing else here reads env.
  { files: ['src/host/host.helper.ts'], rules: { 'harness/no-process-env': 'off' } },
]);
