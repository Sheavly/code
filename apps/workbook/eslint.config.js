import { baseConfig } from '@sheavly/eslint-config';

// An app: baseConfig lets its source read env, print and use the terminal (it is in apps/).
export default baseConfig({
  tsconfigRootDir: import.meta.dirname,
  // The CLI entry point: a file without a kind.
  entryFiles: ['src/workbook/workbook.ts'],
});
