// An interpreter running inline code (a heredoc, `-c`/`-e`, or `python3 -` reading stdin) that
// writes files changes project files without the edit tools, like an in-place editor does: the
// post-edit hook never formats or lints them and the editor shows no diff.
//
// Best-effort like the other guards: it can't read a script's intent, so it looks for what is
// reliably visible. Inline code calls a write API or launches an in-place writer, and a path
// it writes isn't outside the project (a literal path the code names, or none it
// can place, which fails closed). A project script (`node scripts/x.mjs`, `npm run …`) is the
// project's own writer and is allowed, and so is inline code that only reads or prints.
import path from 'node:path';
import { isOutsideProject, programName, splitCommands } from './shell-parse.utils.mjs';

// Interpreters that take a program inline, and the flags that carry it.
const INTERPRETERS = {
  python: ['-c'],
  python3: ['-c'],
  node: ['-e', '--eval', '-p', '--print'],
  deno: ['eval'],
  bun: ['-e', '--eval'],
  ruby: ['-e'],
  perl: ['-e', '-E'],
  php: ['-r'],
};

// Calls that write a file, in the languages above. `open(…, 'w'|'a'|'x'|'+')` is Python's.
const WRITE_CALLS = [
  /\bopen\s*\([^)]*,\s*['"][wax+]/,
  /\b(?:write_text|write_bytes)\s*\(/,
  /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|copyFileSync|renameSync|rmSync|unlinkSync)\s*\(/,
  /\bshutil\.(?:copy|copyfile|move|rmtree)\w*\s*\(/,
  /\bos\.(?:remove|rename|replace|unlink)\s*\(/,
  /\bFile\.(?:write|open)\s*\(/,
  /\bfile_put_contents\s*\(/,
];
// String literals that look like file paths the code names (`'packages/x.ts'`, `"/tmp/out"`).
const PATH_LITERAL = /['"]((?:\.{0,2}\/|[\w@.-]+\/)[^'"\s]*\.\w+|\/[^'"\s]+)['"]/g;

// An inline program may delegate its writes instead of calling a file API itself. Match the
// launched command's arguments, not mentions elsewhere (a print of "prettier --write" is data).
const PROCESS_CALL =
  /\b(?:subprocess\.(?:run|call|check_call|check_output|Popen)|(?:execFile|spawn)(?:Sync)?|system)\s*\(([\s\S]*?)\)/g;

function launchesFileWriter(program) {
  return [...program.matchAll(PROCESS_CALL)].some(
    ([, args]) =>
      (/\bprettier\b/.test(args) && /--write\b/.test(args)) ||
      (/\beslint\b/.test(args) && /--fix\b/.test(args)) ||
      (/\b(?:sed|perl|ruby)\b/.test(args) && /(?:['"]|\s)-(?:[a-z]*i\b|[a-z]*i\.)/.test(args)),
  );
}

/** The inline program a segment's interpreter runs, or null when it runs a script file or none. */
function inlineProgram(params) {
  const { raw, words, heredoc } = params;
  const flags = INTERPRETERS[programName(words[0])];

  if (!flags) return null;

  const args = words.slice(1);
  const flagIndex = args.findIndex((arg) => flags.includes(arg.split('=')[0]));

  // The program is everything after its flag, quotes and all (`-c "import os; …"`).
  if (flagIndex !== -1) return raw.slice(raw.indexOf(args[flagIndex]) + args[flagIndex].length);

  // `python3 - <<EOF`, or a bare interpreter fed a heredoc: the program is the heredoc.
  const runsStdin = args.length === 0 || args[0] === '-';

  return runsStdin && heredoc !== undefined ? heredoc : null;
}

/** Whether `program` writes a file it doesn't place outside the project. */
function writesProject(params) {
  const { program, cwd, projectRoot } = params;

  if (!WRITE_CALLS.some((call) => call.test(program)) && !launchesFileWriter(program)) return false;

  const files = [...program.matchAll(PATH_LITERAL)].map((match) => match[1]);

  // A write with no path it can place (built from variables) fails closed.
  return files.length === 0 || files.some((file) => !isOutsideProject({ file, cwd, projectRoot }));
}

export const INLINE_SCRIPT_FIX =
  'Edit project files with the edit tools (StrReplace/Write), not a script run from the shell (a python/node heredoc or `-c`): only their edits are formatted, linted and checked by the hooks, and shown as a diff. A script may still read, print, or write outside the project (/tmp).';

/** Whether `command`, run from `cwd`, runs inline code that writes a file under `projectRoot`. */
export function findInlineScriptWrite(params) {
  const { command, projectRoot } = params;
  let { cwd } = params;

  for (const { raw, words, heredoc } of splitCommands(command)) {
    if (words[0] === 'cd' && words[1]) cwd = path.resolve(cwd, words[1].replace(/['"]/g, ''));

    const program = inlineProgram({ raw, words, heredoc });

    if (program && writesProject({ program, cwd, projectRoot })) return true;
  }

  return false;
}

// The programs whose writes the hooks trust (SANCTIONED_WRITERS in shell-writes.utils.mjs). Kept
// here as the guard's own list: the cases file the stop hook loads can't import the recorder.
export const KNOWN_WRITERS = new Set(['npm', 'npx', 'git', 'gh', 'turbo']);

export const MIXED_INLINE_FIX =
  'Run inline code (`node -e`, `python3 -c`) on its own line, not in one with a writer (`npm`, `git`, …): when a command changes files, the hooks trust its writers only if nothing else in it could have, and inline code could. Split the command, and change project files only through a writer or the edit tools (StrReplace/Write), whose edits are formatted, linted and shown as a diff.';

/**
 * Whether `command` runs inline code alongside a known writer: what changed then can't be put on
 * the writer, since the inline code may have written it too, so the line's writes go unchecked.
 */
export function findInlineBesideWriter(command) {
  const commands = splitCommands(command);
  const inline = commands.some(({ raw, words, heredoc }) => inlineProgram({ raw, words, heredoc }));

  return inline && commands.some(({ words }) => KNOWN_WRITERS.has(programName(words[0] ?? '')));
}
