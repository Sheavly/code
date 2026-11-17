import { baseConfig } from '@sheavly/eslint-config';

export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // The one place a notice envelope is written: the wording `formatHarnessNotice` is built from.
  { files: ['src/notice/notice.constants.ts'], rules: { 'harness/no-handwritten-notice': 'off' } },
  // The one definition of what a request is in stored history: the helpers every other lookup uses.
  { files: ['src/history/history.utils.ts'], rules: { 'harness/no-adhoc-latest-request': 'off' } },
  // The one caller of `appendInstructionContext`: the factory every instruction source goes through.
  {
    files: ['src/instruction-context/instruction-source.helper.ts'],
    rules: { 'harness/no-direct-instruction-context': 'off' },
  },
  // Looks through the messages a `beforeTurn` hook is handed (a model view) for the context it
  // added earlier, matched by its text; it is not looking for the request in stored history.
  {
    files: ['src/instruction-context/instruction-context.helper.ts'],
    rules: { 'harness/no-adhoc-latest-request': 'off' },
  },
];
