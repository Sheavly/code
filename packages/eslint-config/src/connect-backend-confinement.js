// A development terminal starts a backend of its own and must never attach to a stable server
// instead, so the code that starts it cannot read where one is published, take its lock or use
// the finder that reads and verifies it.
// The terminal app spreads `connectBackendConfinement` into its config; its files are relative to
// that app, and only the folder that holds `connectBackend` is confined: the `sheavly` command
// reads the discovery file elsewhere.

const MESSAGE =
  'connectBackend starts a backend of its own and must never find or attach to a stable server: it cannot read the discovery file, touch the server lock or use the server finder. Finding a server belongs to the code that connects to the installed server, outside this folder.';

const PATHS =
  '/^@sheavly\\/storage\\/(discovery-file|server-lock|server-runtime|server-finder)\\//';

export const connectBackendConfinement = {
  files: ['src/client/**/*.{ts,tsx,js,mjs}'],
  // Its tests and fakes are not what starts a backend.
  ignores: ['src/client/**/__tests__/**', 'src/client/testing/**'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '@sheavly/storage/discovery-file/*',
              '@sheavly/storage/server-lock/*',
              '@sheavly/storage/server-runtime/*',
              '@sheavly/storage/server-finder/*',
            ],
            message: MESSAGE,
          },
        ],
      },
    ],
    // `no-restricted-imports` does not see `import('…')` with a string literal or a template
    // literal without expressions. No other config block sets this rule for the client folder, so
    // this one is the only one that applies.
    'no-restricted-syntax': [
      'error',
      {
        selector: `ImportExpression[source.type='Literal'][source.value=${PATHS}]`,
        message: MESSAGE,
      },
      {
        selector: `ImportExpression[source.type='TemplateLiteral'][source.expressions.length=0][source.quasis.0.value.cooked=${PATHS}]`,
        message: MESSAGE,
      },
    ],
  },
};
