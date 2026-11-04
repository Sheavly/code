import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  // An app: baseConfig lets its source read env, print and use the terminal (it is in apps/).
  ...baseConfig({
    tsconfigRootDir: import.meta.dirname,
    // The backend's entry point: a file without a kind.
    entryFiles: ['src/serve.ts'],
  }),
  // The model-call log (`MODEL_CALLS_FILE`) is a developer's debugging aid, appended to
  // synchronously so a run that dies keeps every call so far. It is not the user's data, and it
  // lives in a file of its own so this is the only hand-rolled write in the backend
  // (`harness/no-direct-file-writes`).
  {
    files: ['src/harness/model-calls.helper.ts'],
    rules: { 'harness/no-direct-file-writes': 'off' },
  },
]);
