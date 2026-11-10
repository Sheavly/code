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
  // A repo's worktrees share one mode and allow list, so every call on the permission store is
  // keyed by `permissionRoot`, never by a folder's own path. Every source file, so moving a call
  // cannot take it out of the rule's reach.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**', 'src/testing/**'],
    rules: { 'harness/permission-store-root': 'error' },
  },
  // The backend is where a key is read and handed to a provider, so `src/profiles/` is the one
  // place in it that imports the profile registry and an open profile (`harness/no-key-holder-import`).
  // Nothing else in the backend does: a handler asks these modules, it never holds a key.
  {
    files: ['src/profiles/**'],
    rules: { 'harness/no-key-holder-import': 'off' },
  },
]);
