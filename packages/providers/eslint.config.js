import { baseConfig } from '@sheavly/eslint-config';

export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // The one reader of server-sent events: every protocol's reply goes through `readReply`.
    files: ['src/http/reply-reader.helper.ts'],
    rules: { 'harness/no-handrolled-reply-reader': 'off' },
  },
];
