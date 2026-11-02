// Which changes need a real-model check (`npm run workbook -- check`), for the stop hook's
// nudge. A check costs model calls, so the hook only asks, once per set of files; it never runs
// one itself. The list is `workbook/run-sources.json`, which the check command reads too, so the
// nudge and the check always agree on what counts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMissingPath, ProjectReadError } from './hooks.errors.mjs';
import { PROJECT_ROOT } from './hooks.utils.mjs';

const RUN_SOURCES_FILE = 'workbook/run-sources.json';

/** `{ include, exclude }` from the shared list; missing means no nudge, broken is said. */
function readRunSources() {
  const file = path.join(PROJECT_ROOT, RUN_SOURCES_FILE);

  let sources;

  try {
    sources = JSON.parse(readFileSync(file, 'utf8'));
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return { include: [], exclude: [] }; // no workbook here
    throw new ProjectReadError({ file: RUN_SOURCES_FILE, cause: caughtError });
  }

  const isList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

  if (isList(sources?.include) && isList(sources?.exclude)) return sources;

  throw new ProjectReadError({
    file: RUN_SOURCES_FILE,
    cause: new TypeError('needs "include" and "exclude" lists of strings'),
  });
}

/** The changed files (relative, `/`-separated) that change what a run does, sorted. */
export function runSourceFiles(changed, sources = readRunSources()) {
  const isRunSource = (file) =>
    sources.include.some((prefix) => file.startsWith(prefix)) &&
    !sources.exclude.some((marker) => file.includes(marker));

  return changed.filter(isRunSource).sort();
}

/** The nudge's key in the "already asked" state, shared with the docs nudge (`onlyNew`). */
export const RUN_CHECK_KEY = 'npm run workbook -- check';

/** The follow-up asking for a real-model check of `files`. */
export function runCheckMessage(files) {
  return (
    'You changed what a run does. Before you finish, run the real-model checks for it: ' +
    '`npm run workbook -- check` (it runs only the checks whose areas you changed, and lists ' +
    "changed source no check covers; add or update a prompt's `check` for those). It costs " +
    "model calls, so run it once, when the change is done. You won't be asked again for these " +
    `files.\n\n${files.map((file) => `- ${file}`).join('\n')}`
  );
}
