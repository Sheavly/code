import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // The credential store is the one module that names the credentials file: it is where the file
  // is read, checked to be private and written. Nothing else in the repo may (`harness/no-credentials-file`).
  { files: ['src/credential-store/**'], rules: { 'harness/no-credentials-file': 'off' } },
]);
