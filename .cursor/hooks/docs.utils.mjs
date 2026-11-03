// Which docs describe which source files, for the stop hook's "update the docs" nudge. Read from
// the workspaces, never listed by hand: a source file belongs to the workspace that holds it, and
// that workspace's README.md and docs/ describe it. A change to one counts for the whole
// workspace. Tests never count: they don't change what the docs describe.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listWorkspaces } from '../../packages/eslint-config/src/layout.utils.js';
import { isMissingPath, ProjectReadError } from './hooks.errors.mjs';
import { PROJECT_ROOT } from './hooks.utils.mjs';

const IS_TEST = /(^|\/)(__tests__|testing)\/|\.test\.[cm]?[jt]s$/;

/** The workspace folders (`packages/core`), relative and `/`-separated, deepest first. */
function workspaceDirs(root) {
  return listWorkspaces(root)
    .map(({ relative }) => relative)
    .filter((dir) => dir !== '.')
    .sort((a, b) => b.length - a.length);
}

/** The docs of the workspace `file` is source of (`packages/core`'s README and docs/), or undefined. */
function docsFor(params) {
  const { file, dirs } = params;
  const dir = dirs.find((candidate) => file.startsWith(`${candidate}/src/`));

  // Only below src/: the workspace folder itself may be called testing (`packages/testing`).
  if (!dir || IS_TEST.test(file.slice(`${dir}/src/`.length))) return undefined;

  return { doc: `${dir}/README.md`, docs: `${dir}/docs/` };
}

/**
 * Workspaces whose source changed while neither their README nor anything in their docs/ did:
 * `[{ doc, files }]`, with `doc` the README to start from.
 */
export function staleDocs(changed, root = PROJECT_ROOT) {
  const dirs = workspaceDirs(root);
  const byDoc = new Map();

  for (const file of changed) {
    const owner = docsFor({ file, dirs });

    if (!owner) continue;

    const touched = changed.some((other) => other === owner.doc || other.startsWith(owner.docs));

    if (!touched) byDoc.set(owner.doc, [...(byDoc.get(owner.doc) ?? []), file]);
  }

  return [...byDoc].map(([doc, files]) => ({ doc, files: files.sort() }));
}

function git(args) {
  const result = spawnSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8' });

  return result.status === 0 ? result.stdout : undefined;
}

/** Files changed since the last commit, tracked or new; undefined if git can't tell. */
export function uncommittedFiles() {
  const tracked = git(['diff', '--name-only', 'HEAD']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);

  if (tracked === undefined || untracked === undefined) return undefined;

  return [...new Set(`${tracked}\n${untracked}`.split('\n').filter(Boolean))];
}

// What was already nudged lives in .git/, so it's never committed and is per clone. A nudge
// repeats only when the set of changed files for a doc grows, never for the same set twice.
function statePath() {
  const relative = git(['rev-parse', '--git-path', 'cursor-docs-nudged.json'])?.trim();

  return relative ? path.resolve(PROJECT_ROOT, relative) : undefined;
}

/** Removes docs already nudged for exactly these files, and remembers the rest. */
export function onlyNew(stale) {
  const file = statePath();

  if (!file) return stale;

  let seen = {};

  try {
    seen = JSON.parse(readFileSync(file, 'utf8'));
  } catch (caughtError) {
    // No state yet: nothing was nudged in this clone. A corrupt file is named, never reset.
    if (!isMissingPath(caughtError)) throw new ProjectReadError({ file, cause: caughtError });
  }

  const fresh = stale.filter(({ doc, files }) => seen[doc] !== files.join('\n'));

  for (const { doc, files } of fresh) seen[doc] = files.join('\n');
  writeFileSync(file, JSON.stringify(seen, null, 2));

  return fresh;
}
