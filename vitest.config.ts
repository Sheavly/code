import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

/** Workspace packages export their source under this condition (see `tsconfig.base.json`). */
const SOURCE_CONDITION = '@sheavly/source';

export default defineConfig({
  // Tests import workspace packages from source, so nothing is built before `vitest`.
  ssr: { resolve: { conditions: [SOURCE_CONDITION, ...defaultServerConditions] } },
  test: {
    // Tests live in __tests__ folders (enforced by ESLint too, so none is silently skipped),
    // in the app, in every package (the ESLint rules are tested with RuleTester) and in scripts/.
    include: [
      'src/**/__tests__/**/*.test.ts',
      'packages/*/src/**/__tests__/**/*.test.{ts,js}',
      'scripts/__tests__/*.test.mjs',
      '.cursor/hooks/__tests__/*.test.mjs',
    ],
    environment: 'node',
    // `.sheavly` hooks are user code the harness loads with Node's own `import()`. Vite must not
    // transform them in tests, or ESM/CommonJS and TypeScript rules would differ from production.
    server: { deps: { external: [/\/\.sheavly\//] } },
  },
});
