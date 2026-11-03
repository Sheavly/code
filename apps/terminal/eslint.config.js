import { baseConfig } from '@sheavly/eslint-config';

// An app: baseConfig lets its source read env, print and use the terminal (it is in apps/).
export default baseConfig({
  tsconfigRootDir: import.meta.dirname,
  // The two CLI entry points: files without a kind.
  entryFiles: ['src/demo.ts', 'src/workbook/workbook.ts'],
});
