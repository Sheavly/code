import { baseConfig } from '@sheavly/eslint-config';

// An app: baseConfig lets its source read env, print and use the terminal (it is in apps/).
export default baseConfig({
  tsconfigRootDir: import.meta.dirname,
  // The CLI entry points: files without a kind.
  entryFiles: ['src/chat.ts', 'src/demo.ts', 'src/serve.ts', 'src/workbook/workbook.ts'],
});
