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
  // The skills source reads folders fixed when the harness is built (the project's and the user's
  // skills folders), never one the agent chooses, and each SKILL.md is resolved through its own
  // folder as a `Workspace`, which refuses a link out of it.
  {
    files: ['src/skills/skills.helper.ts'],
    rules: { 'harness/no-raw-fs-in-instruction-source': 'off' },
  },
  // These resolve a file of a skill's own folder, or a hook file of `.sheavly/`, through a
  // `Workspace` opened on that folder, not the agent's working root: there is no requested path to
  // anchor, and a `.env` name cannot be a skill file's or a hook's (the manifest limits a hook to
  // its extensions; a skill's own `.env` is refused by `read_skill`'s guard).
  {
    files: [
      'src/skills/skills.helper.ts',
      'src/skills/skill-files.helper.ts',
      'src/project-hooks/project-hooks.helper.ts',
    ],
    rules: { 'harness/guard-env-read': 'off', 'harness/guard-working-root': 'off' },
  },
]);
