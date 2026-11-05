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

/** Whether every part of `command` is a known writer or writes nothing. */
export function isSanctionedWriter(command) {
  return toSegments(
    normalize(maskQuotedOperators(withoutHeredocBodies(stripMessages(command)))),
  ).every(isSanctionedSegment);
}
