import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests live in __tests__ folders (enforced by ESLint too, so none is silently skipped),
    // in the app, in every package (the ESLint rules are tested with RuleTester) and in scripts/.
    include: [
      'src/**/__tests__/**/*.test.ts',
      'packages/*/src/**/__tests__/**/*.test.{ts,js}',
      'scripts/__tests__/*.test.mjs',
    ],
    environment: 'node',
    // `.sheavly` hooks are user code the harness loads with Node's own `import()`. Vite must not
    // transform them in tests, or ESM/CommonJS and TypeScript rules would differ from production.
    server: { deps: { external: [/\/\.sheavly\//] } },
  },
});
