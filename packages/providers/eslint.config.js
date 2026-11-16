import { baseConfig } from '@sheavly/eslint-config';

export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // The shared decisions of every protocol: a protocol reads a body, a retry-after header and a
    // reasoning item's source only through the helpers that own them (see the rule's comment).
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**', 'src/testing/**'],
    rules: { 'harness/no-handrolled-provider-policy': 'error' },
  },
  {
    // The one place each decision is made.
    files: ['src/http/request.helper.ts', 'src/http/replay.utils.ts'],
    rules: { 'harness/no-handrolled-provider-policy': 'off' },
  },
  {
    // The one reader of server-sent events: every protocol's reply goes through `readReply`.
    files: ['src/http/reply-reader.helper.ts'],
    rules: { 'harness/no-handrolled-reply-reader': 'off' },
  },
];
