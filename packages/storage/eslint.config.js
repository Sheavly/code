import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // The credential store is the one module that names the credentials file: it is where the file
  // is read, checked to be private and written. Nothing else in the repo may (`harness/no-credentials-file`).
  { files: ['src/credential-store/**'], rules: { 'harness/no-credentials-file': 'off' } },
  // These three modules are where files are written, so every store writes through them: an atomic
  // replace that is private and retried on Windows, an append for a stream, and the path checks.
  // Nothing else here (or anywhere) calls the file system's write functions
  // (`harness/no-direct-file-writes`).
  {
    // `output-store/` appends a command's output to its log as it arrives, privately, under a
    // folder it names by a UUID (`namedPath`): a stream too large for an atomic whole-file write.
    files: [
      'src/json-file/**',
      'src/jsonl-file/**',
      'src/safe-path/**',
      // The cross-process lock is a file made and removed on purpose, holding only a process id.
      'src/file-lock/**',
      'src/output-store/output-store.service.ts',
      'src/output-store/output-writer.service.ts',
      'src/output-store/__tests__/**',
    ],
    rules: { 'harness/no-direct-file-writes': 'off' },
  },
]);
