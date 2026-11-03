import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

/** Workspace packages export their source under this condition (see `tsconfig.base.json`). */
const SOURCE_CONDITION = '@sheavly/source';
/** `vitest --mode all` (`npm run test:watch`): one run over every workspace's tests. */
const ALL_WORKSPACES_MODE = 'all';

export default defineConfig(({ mode }) => ({
  // Tests import workspace packages from source, so nothing is built before `vitest`.
  ssr: { resolve: { conditions: [SOURCE_CONDITION, ...defaultServerConditions] } },
  test: {
    // Tests live in __tests__ folders (enforced by ESLint too, so none is silently skipped), in
    // every workspace (the ESLint rules are tested with RuleTester), in scripts/ and the hooks.
    // Globs are relative to the directory Vitest runs in: a workspace's `test` script runs this
    // config from the workspace, where `src/` is its own source and the other globs match nothing.
    // From the root it runs the scripts' and the hooks' tests; `npm test` runs all workspaces
    // through turbo. The watcher adds the workspaces' tests, so one process watches all.
    include: [
      'src/**/__tests__/**/*.test.{ts,js}',
      'scripts/__tests__/*.test.mjs',
      '.cursor/hooks/__tests__/*.test.mjs',
      ...(mode === ALL_WORKSPACES_MODE
        ? ['{packages,apps}/*/src/**/__tests__/**/*.test.{ts,js}']
        : []),
    ],
    environment: 'node',
    // The hooks' and scripts' tests spawn real processes (ESLint, npm, git). Under `npm run check`
    // they run beside every workspace's tests, where the 5s default is too tight.
    testTimeout: 30_000,
    // `.sheavly` hooks are user code the harness loads with Node's own `import()`. Vite must not
    // transform them in tests, or ESM/CommonJS and TypeScript rules would differ from production.
    server: { deps: { external: [/\/\.sheavly\//] } },
  },
}));
