import { baseConfig } from '@sheavly/eslint-config';

export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // The one place a notice envelope is written: the wording `formatHarnessNotice` is built from.
  { files: ['src/notice/notice.constants.ts'], rules: { 'harness/no-handwritten-notice': 'off' } },
  // The one definition of what a request is in stored history: the helpers every other lookup uses.
  { files: ['src/history/history.utils.ts'], rules: { 'harness/no-adhoc-latest-request': 'off' } },
];
