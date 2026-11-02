import { baseConfig } from '@sheavly/eslint-config';
import { defineConfig } from 'eslint/config';

// The bottom layer: the wire contract depends on zod only. Its `rootDir` already makes an import
// of the app a type error; this keeps the other workspace packages out too.
export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@sheavly/*'],
              message:
                '@sheavly/protocol is the bottom layer: it depends on zod only, never on core, providers or the app.',
            },
          ],
        },
      ],
    },
  },
]);
