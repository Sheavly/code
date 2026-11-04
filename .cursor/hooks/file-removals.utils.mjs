// A deletion chained with a writer (`npm uninstall … ; rm -rf /tmp/probe`) hides what each part
// changed: the hooks trust a writer's file changes (package.json, the lockfile) only when nothing
// else in the line could have made them, and `rm` could have. The deletion may well be outside the
// project (a /tmp probe), but the guard can't tell what a variable or glob reaches, so a line that
// mixes the two is split: the writer on its own, and the deletion on its own (project files
// through the Delete tool).
import { KNOWN_WRITERS } from './inline-scripts.utils.mjs';
import { programName, splitCommands } from './shell-parse.utils.mjs';

const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'shred']);

export const REMOVAL_FIX =
  'Run `rm` on its own line, not in one with a writer (`npm`, `git`, …): when a command changes files, the hooks trust its writers only if nothing else in it could have, and `rm` could. Split the command, and change project files only through a writer or the edit tools (StrReplace/Write), whose edits are formatted, linted and shown as a diff; delete project files with the Delete tool.';

/** Whether `command` deletes files in the same line as a known writer. */
export function findRemovalBesideWriter(command) {
  const programs = splitCommands(command).map(({ words }) => programName(words[0] ?? ''));

  return (
    programs.some((name) => DELETERS.has(name)) && programs.some((name) => KNOWN_WRITERS.has(name))
  );
}
