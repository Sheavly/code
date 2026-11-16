// Which files a shell command changed, read from disk rather than from the command: the shell
// guard snapshots the project before the command runs (record-shell-writes.mjs compares after).
// A file a command changed skipped the edit tools' hooks, so it is recorded for the stop hook's
// gate, and a command that isn't a known writer is a workaround the shell guard must learn.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { hookNow, PROJECT_ROOT } from './hooks.utils.mjs';
import { isMissingPath } from './hooks.errors.mjs';
import {
  isOutsideProject,
  maskQuotedOperators,
  normalize,
  programName,
  startsWithNonExecuting,
  stripMessages,
  toSegments,
  withoutHeredocBodies,
} from './shell-parse.utils.mjs';

function git(params) {
  const { root, args } = params;
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });

  return result.status === 0 ? result.stdout : null;
}

function hashFile(file) {
  try {
    if (!statSync(file).isFile()) return 'not-a-file';

    return createHash('sha1').update(readFileSync(file)).digest('hex');
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return 'deleted'; // a deletion is a change too
    throw caughtError;
  }
}

/** Paths `git status -z` lists: each entry's path, and a rename's or copy's source as well. */
function readStatusPaths(output) {
  return output
    .split('\0')
    .filter(Boolean)
    .map((entry) => (/^[ MADRCU?!]{2} /.test(entry) ? entry.slice(3) : entry));
}

/**
 * `HEAD`, when it was taken, and a hash of every file `git status` lists (tracked changes and
 * untracked files; ignored ones like node_modules and dist are left out). Null outside a git repo.
 */
export function snapshotProject(root) {
  const takenAt = hookNow();
  const status = git({ root, args: ['status', '--porcelain=v1', '-z', '--untracked-files=all'] });

  if (status === null) return null;
  const files = {};

  for (const file of readStatusPaths(status)) files[file] = hashFile(path.join(root, file));

  return { head: git({ root, args: ['rev-parse', 'HEAD'] })?.trim() ?? null, takenAt, files };
}

/**
 * The project files whose contents differ between two snapshots. A moved `HEAD` (a commit, a
 * checkout) changes what git lists for reasons of its own, so it is read as no change: git
 * commands go through the git guard.
 */
export function changedFiles(params) {
  const { before, after } = params;

  if (before.head !== after.head) return [];
  const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);

  return [...paths].filter((file) => before.files[file] !== after.files[file]).sort();
}

// Programs whose writes are reviewed elsewhere: git (the git guard), and npm/npx/turbo, which run
// the project's own scripts and bins (installs, `npm run format`, `npx prettier --write`). A
// command that changed files is a workaround unless every part of it is one of these, a `cd`, or a
// program that only prints or searches. Grow this list by hand, in review: never to let a
// workaround through.
const SANCTIONED_WRITERS = new Set(['git', 'gh', 'npm', 'npx', 'turbo']);
// Project scripts that only print what they find (`npm run layout` runs the first); named in full,
// since any other script could have been written with the edit tools to write files.
const READ_ONLY_SCRIPTS = new Set(['scripts/check-layout.mjs']);
const FD_DUPLICATION = /^\d*>&\d+$/;
const REDIRECT = /^\d*>>?$/;
// Launchers that run the next word as the program with its own arguments; their own options
// before it (a duration, `-n 10`) are read past.
const LAUNCHERS = new Set(['timeout', 'nice', 'time', 'env']);

/** The word that runs as the program: past a launcher (`timeout 120 npm test` runs `npm`). */
function programOf(tokens) {
  let index = 0;

  while (LAUNCHERS.has(programName(tokens[index] ?? ''))) {
    index++;
    while (/^(-|\d)/.test(tokens[index] ?? '')) index++; // its options and a duration
  }

  return tokens.slice(index);
}

function isReadOnlyScript(tokens) {
  const [program, script, ...rest] = tokens;

  return (
    programName(program ?? '') === 'node' &&
    READ_ONLY_SCRIPTS.has(script ?? '') &&
    rest.every((token) => FD_DUPLICATION.test(token))
  );
}

function isSanctionedSegment(segment) {
  const tokens = programOf(segment);
  const redirectsToFile = tokens.some(
    (token, index) => REDIRECT.test(token) && !isOutsideRedirect(tokens[index + 1]),
  );

  if (redirectsToFile) return false;

  return (
    tokens[0] === 'cd' ||
    SANCTIONED_WRITERS.has(programName(tokens[0])) ||
    startsWithNonExecuting(tokens) ||
    isLinePrint(tokens) ||
    isReadOnlyScript(tokens)
  );
}

/**
 * Whether a redirect's `target` is a file the command can't have changed the project through: an
 * absolute path outside it (`/tmp/out.txt`, `/dev/null`). A relative one is taken to be inside,
 * since an earlier `cd` in the line may have moved it, and one with no target fails closed.
 */
function isOutsideRedirect(target) {
  return (
    typeof target === 'string' &&
    path.isAbsolute(target) &&
    isOutsideProject({ file: target, cwd: PROJECT_ROOT, projectRoot: PROJECT_ROOT })
  );
}

// `sed -n '3,9p' file` prints lines. Any other sed script can write (`w file`, `s///w file`) or run
// a command (`e`), and `-i` edits in place, so this one form is the only sed read taken on trust.
const LINE_PRINT_SCRIPT = /^(\d+|\$)(,(\d+|\$))?p$/;

function isLinePrint(tokens) {
  if (programName(tokens[0] ?? '') !== 'sed' || tokens[1] !== '-n') return false;

  const script = (tokens[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');

  return LINE_PRINT_SCRIPT.test(script) && tokens.slice(3).every((token) => !token.startsWith('-'));
}

// `sh -c "npx prettier --write a.ts; npx vitest run"` is the command line inside the quotes, run
// by a shell: it is read as that line, and trusted only when every part of it is. The wrapper must
// be the whole command, so nothing else can ride along outside the quotes.
const SHELL_WRAPPER = /^\s*(?:\S*\/)?(?:ba|z)?sh\s+-c\s+(?:"([^"$`\\]*)"|'([^']*)')\s*$/;

/** The command line a `sh -c '…'` wrapper runs, or null when `command` is not just that. */
function wrappedCommand(command) {
  const match = SHELL_WRAPPER.exec(command);

  return match ? (match[1] ?? match[2] ?? null) : null;
}

// The line is split after the quoted text is masked (so a `;` in a pattern is not a separator),
// and the masking pairs quotes left to right without knowing the shell's other ways to quote or
// escape. Anything the shell reads differently hides a command from the check, so a line that
// holds one is not trusted (it fails closed, and is only looked at when it changed files):
// - `$(…)`, `${…}` or a backtick inside double quotes, which still runs: `npx x "$(cp a b)"`;
// - an escaped quote (`\"`, `\'`), which the masking takes for a real one;
// - ANSI-C quoting (`$'…'`), whose `\'` the masking takes for the end of the string;
// - a quote left open.
// Single-quoted text is literal and is skipped.
const SUBSTITUTION = /\$\(|\$\{|`/;

/** The quote open after `char` (`'`, `"` or null for none), given the one open before it. */
function quoteAfter(params) {
  const { quote, char } = params;

  if (quote === null) return char === '"' || char === "'" ? char : null;

  return char === quote ? null : quote;
}

/** Whether `char` and what follows it hides a command, outside single quotes. */
function hidesCommand(params) {
  const { quote, char, next } = params;

  if (char === '\\') return next === '"' || next === "'";
  if (char === '$' && next === "'") return true;

  return quote === '"' && SUBSTITUTION.test(char + (next ?? ''));
}

function quotingHidesCommands(text) {
  let quote = null;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];

    if (quote !== "'" && hidesCommand({ quote, char, next })) return true;
    // An escaped character is literal, so it opens and closes nothing.
    if (quote !== "'" && char === '\\') index++;
    else quote = quoteAfter({ quote, char });
  }

  return quote !== null;
}

const HERE_STRING = /<<</;
const HEREDOC_OPENER = /<<-?\s*(['"]?)(\w+)\1/;

/** Whether `index` in `line` is inside quotes: an odd number of either quote comes before it. */
function insideQuote(params) {
  const { line, index } = params;

  return ['"', "'"].some((quote) => line.slice(0, index).split(quote).length % 2 === 0);
}

/**
 * Whether the heredocs of `command` could hide a command. Lines after a heredoc opener are taken
 * for its body and dropped before the line is read, so a `<<` that is no heredoc (a here-string
 * `<<<`, or text inside quotes) would drop real commands with it. And the shell expands `$(…)` in
 * the body of an unquoted-delimiter heredoc (`<<EOF`), unlike `<<'EOF'`, whose body is literal.
 */
function heredocsHideCommands(command) {
  if (HERE_STRING.test(command)) return true;

  const lines = command.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const opener = HEREDOC_OPENER.exec(line);

    if (!opener) continue;
    if (insideQuote({ line, index: opener.index })) return true;

    const end = lines.findIndex((next, at) => at > index && next.trim() === opener[2]);
    const stop = end === -1 ? lines.length : end;

    if (opener[1] === '' && SUBSTITUTION.test(lines.slice(index + 1, stop).join('\n'))) {
      return true;
    }

    index = stop;
  }

  return false;
}

// The one substitution a commit or PR message may hold: `"$(cat <<'EOF' … EOF)"`, whose body is
// literal text. Any other `$(…)` in a message runs like one anywhere else.
const SAFE_MESSAGE = /"\$\(cat <<-?\s*'(\w+)'\n[\s\S]*?\n\s*\1\s*\)"/g;

/** Whether every part of `command` is a known writer or writes nothing. */
export function isSanctionedWriter(command) {
  const inner = wrappedCommand(command);

  if (inner !== null) return isSanctionedWriter(inner);

  // The checks below read the command with its messages still in it: a message in double quotes
  // is shell too (`git commit -m "$(cp a b)"`), so it is only blanked after they have looked.
  const kept = command.replace(SAFE_MESSAGE, '"MESSAGE"');

  if (heredocsHideCommands(kept)) return false;

  const text = withoutHeredocBodies(kept);

  if (quotingHidesCommands(text)) return false;

  return toSegments(normalize(maskQuotedOperators(stripMessages(text)))).every(isSanctionedSegment);
}
