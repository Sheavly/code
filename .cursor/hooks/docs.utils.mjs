// Which doc in docs/ describes which source files, for the stop hook's "update the docs" nudge.
// A file belongs to the first doc whose pattern matches, so specific areas come first. Tests
// never count: they don't change what the docs describe.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMissingPath, ProjectReadError } from './hooks.errors.mjs';
import { PROJECT_ROOT } from './hooks.utils.mjs';

const DOC_SOURCES = [
  {
    doc: 'docs/sessions.md',
    sources: [
      /^packages\/core\/src\/session\//,
      /^src\/runtime\/sessions\//,
      /^src\/tools\/sub-agent\//,
    ],
  },
  {
    doc: 'docs/hooks.md',
    sources: [
      /^packages\/core\/src\/hook\//,
      /^src\/loop\/hooks\//,
      /^src\/runtime\/project-hooks\//,
      /^src\/runtime\/agents-md\//,
    ],
  },
  { doc: 'docs/tools.md', sources: [/^packages\/core\/src\/tool\//, /^src\/tools\//] },
  {
    doc: 'docs/overview.md',
    sources: [/^packages\/core\/src\//, /^src\//, /^eslint\.config\.js$/],
  },
];

const IS_TEST = /(^|\/)__tests__\/|\.test\.[cm]?[jt]s$/;

/** The doc that describes `file` (relative, `/`-separated), or undefined. */
function docFor(file) {
  if (IS_TEST.test(file)) return undefined;

  return DOC_SOURCES.find(({ sources }) => sources.some((source) => source.test(file)))?.doc;
}

/** Docs whose source files changed while the doc itself didn't: `[{ doc, files }]`. */
export function staleDocs(changed) {
  const byDoc = new Map();

  for (const file of changed) {
    const doc = docFor(file);

    if (doc && !changed.includes(doc)) byDoc.set(doc, [...(byDoc.get(doc) ?? []), file]);
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
