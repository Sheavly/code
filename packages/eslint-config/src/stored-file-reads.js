// A stored `profile.json` and conversation `index.json` are read through the schemas that also take
// the files written before "mode" became "effort" (`legacy-effort/` in `@sheavly/storage`); the
// plain protocol schemas reject those files, so a store that parsed with them would lose old data.
// The storage package spreads `storedFileReads` into its config; its files are relative to it.

export const storedFileReads = {
  files: ['src/**/*.ts'],
  // The migration itself and the tests may use the plain schemas.
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
};
