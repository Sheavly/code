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
];
