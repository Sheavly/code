import { baseConfig } from '@sheavly/eslint-config';

export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // These two work on the messages a model is sent, not on stored history: a hook's input and the
  // view `assertValidHistory` checks, where a notice is a `user` message too. They look for the
  // last `user` message of that view on purpose, so the shared stored-history lookup does not fit.
  {
    files: ['src/history/history.utils.ts', 'src/hooks/hooks.helper.ts'],
    rules: { 'harness/no-adhoc-latest-request': 'off' },
  },
  // `publishNotice` is where a kind's lifetime becomes a history entry. Restoring reports writes
  // entries for a reopened conversation without sending any event, so it has no lifetime to apply.
  {
    files: [
      'src/stream-agent/notice-publish.helper.ts',
      'src/stream-agent/restored-reports.helper.ts',
    ],
    rules: { 'harness/no-adhoc-notice-entry': 'off' },
  },
];
