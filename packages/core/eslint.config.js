import { baseConfig } from '@sheavly/eslint-config';

export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // The one place a notice envelope is written: the wording `formatHarnessNotice` is built from.
  { files: ['src/notice/notice.constants.ts'], rules: { 'harness/no-handwritten-notice': 'off' } },
];
