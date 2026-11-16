import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // `answerWhileWaiting` is where "no longer waiting" is matched, once, for every UI.
  {
    files: ['src/approvals/approvals.helper.ts'],
    rules: { 'harness/no-adhoc-unknown-approval': 'off' },
  },
]);
