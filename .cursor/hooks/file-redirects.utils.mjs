// A redirect into a project file (`printf x >> src/a.ts`, `cat > README.md <<EOF`) writes it
// without the edit tools, like an in-place editor does: the post-edit hook never formats or lints
// it and the editor shows no diff. Agents write project files with StrReplace/Write.
//
// Best-effort like the other guards: only unquoted redirects count (`rg '=>' src` is a pattern),
// `2>&1` duplicates a descriptor rather than writing a file, and a target outside the project
// (`> /tmp/x`, `> /dev/null`) edits nothing in it.
import path from 'node:path';
import { isOutsideProject, splitCommands } from './shell-parse.utils.mjs';

export const REDIRECT_FIX =
  'Write project files with the edit tools (StrReplace/Write), not by redirecting a command into one (`>`, `>>`): only their edits are formatted, linted and checked by the hooks, and shown as a diff. Redirecting into a file outside the project (`> /tmp/out.txt`) is fine.';

// `>`, `>>`, `2>` or `&>` and the word after it (attached or not); `>&` is a descriptor copy.
const REDIRECT = /(?:\d|&)?>>?(?!&)\s*(\S*)/g;

/** The files `raw`, a command's text with its quotes, redirects its output into. */
function redirectTargets(raw) {
  // Quoted strings are data; a quoted target becomes "" and so fails closed (it can't be placed).
  const bare = raw.replace(/"[^"]*"|'[^']*'/g, '""');

  return [...bare.matchAll(REDIRECT)].map((match) => match[1].replaceAll('"', ''));
}

/** Whether `command`, run from `cwd`, redirects its output into a file of `projectRoot`. */
export function findProjectRedirect(params) {
  const { command, projectRoot } = params;
  let { cwd } = params;

  for (const { raw, words } of splitCommands(command)) {
    if (words[0] === 'cd' && words[1]) cwd = path.resolve(cwd, words[1]);

    const writesProject = redirectTargets(raw).some(
      (file) => !isOutsideProject({ file, cwd, projectRoot }),
    );

    if (writesProject) return true;
  }

  return false;
}
