import { defineConfig } from 'eslint/config';
import { baseConfig } from '@sheavly/eslint-config';

export default defineConfig([
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  // The scratch folder is not user data: only `src/scratch/` creates it (mode 0700, owner
  // checked) and prunes stale entries from it. `Workspace` calls it and writes nothing itself
  // (`harness/no-direct-file-writes`).
  {
    files: ['src/scratch/scratch-root.helper.ts', 'src/scratch/scratch.helper.ts'],
    rules: { 'harness/no-direct-file-writes': 'off' },
  },
  // The confined reader opens a file with `fs.open` to read through the open handle, which is what
  // closes the race between checking a path and reading it. The flags are `O_RDONLY`: it writes
  // nothing, and `open` is on the file-writes rule's list only because it can write.
  {
    files: ['src/instruction-context/confined-read.helper.ts'],
    rules: { 'harness/no-direct-file-writes': 'off' },
  },
  // The skills source reads folders fixed when the harness is built (the project's and the user's
  // skills folders), never one the agent chooses, and each SKILL.md is resolved through its own
  // folder as a `Workspace`, which refuses a link out of it.
  {
    files: ['src/skills/skills.helper.ts'],
    rules: { 'harness/no-raw-fs-in-instruction-source': 'off' },
  },
]);
