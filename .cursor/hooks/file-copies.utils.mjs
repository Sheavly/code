// Copying or moving a file into the project (`cp /tmp/x.ts src/`, `mv`, `install`, `rsync`)
// writes it without the edit tools, like an in-place editor does: the post-edit hook never formats
// or lints it and the editor shows no diff. Agents write project files with StrReplace/Write.
//
// Best-effort like the other guards: the destination is the last file operand (or `-t <dir>`),
// and a copy whose destination it can't place outside the project is denied. Copying out of the
// project (`cp src/a.ts /tmp/`) edits nothing in it and stays allowed.
import path from 'node:path';
import {
  isOutsideProject,
  programName,
  splitCommands,
  startsWithNonExecuting,
} from './shell-parse.utils.mjs';

const COPIERS = new Set(['cp', 'mv', 'install', 'rsync', 'ln']);
// Flags that take the next word as their value; `-t`/`--target-directory` names the destination.
const VALUE_FLAGS = new Set([
  '-t',
  '--target-directory',
  '-S',
  '--suffix',
  '-m',
  '--mode',
  '-o',
  '-g',
]);
const TARGET_FLAGS = new Set(['-t', '--target-directory']);

export const COPY_FIX =
  'Write project files with the edit tools (StrReplace/Write), not by copying or moving one in from the shell (`cp`, `mv`): only their edits are formatted, linted and checked by the hooks, and shown as a diff.';

/** Where a copy writes: its `-t <dir>`, or else its last file operand. Undefined with none. */
function destinationOf(args) {
  const operands = [];
  let target;

  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = args[index].split(/=(.*)/s);

    if (TARGET_FLAGS.has(flag)) target = inline ?? args[index + 1];
    if (VALUE_FLAGS.has(flag) && inline === undefined) index++;
    else if (!args[index].startsWith('-')) operands.push(args[index]);
  }

  return target ?? (operands.length > 1 ? operands.at(-1) : undefined);
}

/** Whether `command`, run from `cwd`, copies or moves a file into `projectRoot`. */
export function findProjectCopy(params) {
  const { command, projectRoot } = params;
  let { cwd } = params;

  // A heredoc's body is input, not commands; quoted words are data (an `rg 'cp|mv'` pattern).
  for (const { words } of splitCommands(command)) {
    const tokens = words.filter((word) => !/^\d*>/.test(word));

    if (tokens[0] === 'cd' && tokens[1]) cwd = path.resolve(cwd, tokens[1]);
    if (startsWithNonExecuting(tokens) || !COPIERS.has(programName(tokens[0] ?? ''))) continue;

    const destination = destinationOf(tokens.slice(1));

    // No destination it can read: it may write anywhere it was handed, so it fails closed.
    if (destination === undefined || !isOutsideProject({ file: destination, cwd, projectRoot })) {
      return true;
    }
  }

  return false;
}
