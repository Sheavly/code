// What the shell guard (guard-shell-commands.mjs) denies, as one function the stop hook reuses
// to check a workaround was learned. A new workaround is a new check here, with its command in
// DENIED_CASES (shell-guard-cases.utils.mjs).
import { COPY_FIX, findProjectCopy } from './file-copies.utils.mjs';
import { findInPlaceEdit, IN_PLACE_FIX } from './in-place-edits.utils.mjs';
import {
  findInlineBesideWriter,
  findInlineScriptWrite,
  INLINE_SCRIPT_FIX,
  MIXED_INLINE_FIX,
} from './inline-scripts.utils.mjs';
import { stripMessages } from './shell-parse.utils.mjs';

/** Why the guard denies `command` run from `cwd`, or null when it allows it. */
export function findShellViolation(params) {
  const { cwd, projectRoot } = params;
  const command = stripMessages(params.command);

  if (findInPlaceEdit({ command, cwd, projectRoot })) {
    return {
      user_message: 'Blocked an agent command that edits a project file in place from the shell',
      agent_message: IN_PLACE_FIX,
    };
  }

  if (findInlineScriptWrite({ command, cwd, projectRoot })) {
    return {
      user_message: 'Blocked an agent command that writes project files from an inline script',
      agent_message: INLINE_SCRIPT_FIX,
    };
  }

  if (findInlineBesideWriter(command)) {
    return {
      user_message: 'Blocked an agent command that runs inline code in the same line as a writer',
      agent_message: MIXED_INLINE_FIX,
    };
  }

  if (findProjectCopy({ command, cwd, projectRoot })) {
    return {
      user_message: 'Blocked an agent command that copies or moves a file into the project',
      agent_message: COPY_FIX,
    };
  }

  return null;
}
