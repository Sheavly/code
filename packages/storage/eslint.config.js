import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // A stored `profile.json` and conversation `index.json` are read through the schemas that also
  // take the files written before "mode" became "effort" (`src/legacy-effort/`); the plain protocol
  // schemas would reject those files, so a store that parsed with them would lose old data.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/legacy-effort/**', 'src/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@sheavly/protocol/profile/profile.validator',
              importNames: ['profileSchema'],
              message:
                'Read a stored profile.json with storedProfileFileSchema (legacy-effort/legacy-effort.validator): profileSchema rejects files written before "mode" became "effort".',
            },
            {
              name: '@sheavly/protocol/store/store.validator',
              importNames: ['storedConversationSchema'],
              message:
                'Read a stored index.json with storedConversationIndexSchema (legacy-effort/legacy-effort.validator): storedConversationSchema rejects files written before "mode" became "effort".',
            },
          ],
        },
      ],
    },
  },
  // The credential store is the one module that names the credentials file: it is where the file
  // is read, checked to be private and written. Nothing else in the repo may (`harness/no-credentials-file`).
  { files: ['src/credential-store/**'], rules: { 'harness/no-credentials-file': 'off' } },
  // A bare `SerialQueue` orders one process only. These three own a queue on purpose: the
  // primitive itself, the append-only logs (one writer per conversation, so no lock), and the
  // profile queue that orders a check with a delete, whose config writes lock through the store.
  {
    files: [
      'src/serial-queue/locked-change.service.ts',
      'src/conversation-store/append-log.service.ts',
      'src/profile-registry/profile-registry.service.ts',
    ],
    rules: { 'harness/no-raw-serial-queue': 'off' },
  },
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
