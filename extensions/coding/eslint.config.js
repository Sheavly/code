import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // A tool, or the helper it moves a read into, that resolves a path for reading must refuse
  // `.env` files around it. Every source file of this package, so splitting a tool in two
  // cannot take the read out of the rule's reach. A path resolved for a write or a delete goes
  // through `files.helper.ts` (which refuses `.env` and `.git` on both sides), never
  // `Workspace.resolveWrite` / `resolveDelete` directly.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**', 'src/testing/**'],
    rules: {
      'harness/guard-env-read': 'error',
      'harness/guard-env-write': 'error',
      'harness/guard-search-root': 'error',
      'harness/guard-working-root': 'error',
    },
  },
  // A tool file asks the guard in `files/files.helper.ts` for a path; it never resolves one itself.
  {
    files: ['src/**/*.tool.ts'],
    ignores: ['src/**/__tests__/**'],
    rules: { 'harness/guard-file-tool-resolve': 'error' },
  },
  // The agent's file tools write a project through the filesystem effects in this one helper,
  // which `Workspace` has confined; the user's own data is `@sheavly/storage`'s
  // (`harness/no-direct-file-writes`). A tool calls it rather than importing `node:fs` itself.
  {
    files: ['src/files/file-effects.helper.ts'],
    rules: { 'harness/no-direct-file-writes': 'off' },
  },
  // The guarded resolvers are the one place `Workspace.resolveRead` / `resolveWrite` /
  // `resolveDelete` are called for a tool's own path, with the `.env` and `.git` guards on both
  // sides, in `resolveGuarded` rather than in each resolver (so the per-function env rules are off).
  {
    files: ['src/files/files.helper.ts'],
    rules: { 'harness/guard-env-write': 'off', 'harness/guard-env-read': 'off' },
  },
  // The skills source lists folders fixed when the harness is built (the project's and the user's
  // skills folders) with `readdir` and `stat`, never one the agent chooses. It reads no file
  // itself: each SKILL.md goes through `guarded-read.helper.ts`, which refuses `.env` and a link
  // out of the skill's folder. The rule is per file, so this stays for this one file.
  {
    files: ['src/skills/skills.helper.ts'],
    rules: { 'harness/no-raw-fs-in-instruction-source': 'off' },
  },
  // What a skill or a project hook names is a path the repo chose, so its content is read only
  // through `files/guarded-read.helper.ts`, which refuses `.env` and a link out of the folder.
  // `readdir`, `stat` and `lstat` stay allowed: they read no content. `guard-env-read` sees only
  // `Workspace#resolveRead` calls, so this import ban keeps the usual named read imports out of
  // these folders. It is a guard against a slip, not a proof: a default or `promises` import, a
  // `require` or a dynamic `import()` of `node:fs` still get through, which review has to catch.
  // `baseConfig` sets no other `no-restricted-imports` for these files, so this block replaces nothing.
  {
    files: ['src/skills/**/*.ts', 'src/project-hooks/**/*.ts'],
    ignores: ['src/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['node:fs', 'node:fs/promises', 'fs', 'fs/promises'].map((name) => ({
            name,
            importNames: ['readFile', 'readFileSync', 'open', 'createReadStream'],
            message:
              'Read a skill or project-hook file through `readGuardedFile` (`src/files/guarded-read.helper.ts`): it refuses `.env` files and a link out of the folder.',
          })),
        },
      ],
    },
  },
  // This one helper resolves a file of a skill's own folder, or of `.sheavly/`, through a
  // `Workspace` opened on that folder: no working root applies, so there is no requested path to
  // anchor. It still refuses `.env` on both sides (`harness/guard-env-read` stays on), and the
  // skills and project-hooks helpers read through it, so their reads are held by that check.
  {
    files: ['src/files/guarded-read.helper.ts'],
    rules: { 'harness/guard-working-root': 'off' },
  },
]);
