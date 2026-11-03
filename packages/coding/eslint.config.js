import { baseConfig } from '@sheavly/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // `trustStoreFromEnv` is where a coding host reads where the trust store lives
  // (`SHEAVLY_TRUST_FILE`, `XDG_CONFIG_HOME`), as `providerFromEnv` does for the model in
  // @sheavly/host. Nothing else here reads env.
  { files: ['src/preset/coding.helper.ts'], rules: { 'harness/no-process-env': 'off' } },
]);
