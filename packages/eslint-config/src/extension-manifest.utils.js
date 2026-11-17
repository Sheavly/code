// What the layout says about an extension's `sheavly.json` (see packages/extension/docs/manifest.md),
// read with `JSON.parse` only: this package depends on neither `@sheavly/extension` nor zod, so
// the manifest's schema is validated where the manifest is read, and here only what ties the
// file to its workspace: it exists, names the folder, lists the extensions the package depends
// on, and ships. The `defineExtension` call that reads it is `harness/extension-definition`'s.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MANIFEST_FILE = 'sheavly.json';

/**
 * The `sheavly.json` in the workspace at `dir`: `{ exists: false }`, `{ exists: true, error }`
 * when it isn't JSON, or when it can't be read at all (a directory, no permission: the error
 * code, with `unreadable: true`), or `{ exists: true, data }` with what `JSON.parse` returned.
 */
export function readSheavlyJson(dir) {
  const file = path.join(dir, MANIFEST_FILE);

  if (!existsSync(file)) return { exists: false };

  try {
    return { exists: true, data: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (caughtError) {
    if (caughtError instanceof SyntaxError) return { exists: true, error: caughtError.message };

    // A file system error (EISDIR, EACCES, ...) is a problem with this workspace's file, which the
    // layout check reports; anything without a `code` is a bug here and propagates.
    if (caughtError instanceof Error && typeof caughtError.code === 'string') {
      return { exists: true, error: caughtError.code, unreadable: true };
    }

    throw caughtError;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `dependsOn` the file lists; a wrong type is reported by the caller, so it reads as none. */
const listedDependencies = (data) => (Array.isArray(data.dependsOn) ? data.dependsOn : []);

/** The folders of the other extension workspaces `entry`'s package depends on at runtime. */
function dependencyFolders(params) {
  const { entry, layout } = params;

  return entry.dependsOn
    .filter((dependency) => layout[dependency]?.kind === 'extension')
    .map((dependency) => path.posix.basename(layout[dependency].dir));
}

function dataProblems(params) {
  const { name, entry, layout, data } = params;
  const folder = path.posix.basename(entry.dir);
  const where = `${name}'s ${MANIFEST_FILE}`;

  if (!isRecord(data)) return [`${where} must be a JSON object: write \`{ "name": "${folder}" }\``];

  const problems = [];

  if (data.name !== folder) {
    problems.push(
      `${where} must have "name": "${folder}", the folder name${typeof data.name === 'string' ? ` (it says '${data.name}')` : ''}`,
    );
  }

  if (data.dependsOn !== undefined && !Array.isArray(data.dependsOn)) {
    return [...problems, `${where} "dependsOn" must be an array of extension names`];
  }

  const listed = new Set(listedDependencies(data));
  const wanted = dependencyFolders({ entry, layout });

  return [
    ...problems,
    ...wanted
      .filter((folderName) => !listed.has(folderName))
      .map(
        (folderName) =>
          `${where} "dependsOn" must list '${folderName}', an extension in this package's dependencies: add it`,
      ),
    ...[...listed]
      .filter((listedName) => !wanted.includes(listedName))
      .map(
        (listedName) =>
          `${where} "dependsOn" lists '${listedName}', which is not an extension in this package's dependencies (devDependencies don't count): remove it, or add the dependency`,
      ),
  ];
}

/**
 * What is wrong with the `sheavly.json` of `entry`: an extension (`extensions/*`) has one, that
 * names the folder, lists its extension dependencies (as a set) and is published; any other
 * workspace has none.
 */
export function manifestProblems(params) {
  const { name, entry, layout } = params;
  const found = entry.sheavlyJson ?? { exists: false };

  if (entry.kind !== 'extension') {
    return found.exists
      ? [
          `${name} has a ${MANIFEST_FILE}, but only an extension (extensions/*) has one: remove ${entry.dir}/${MANIFEST_FILE}`,
        ]
      : [];
  }

  const shipped = Array.isArray(entry.files) && entry.files.includes(MANIFEST_FILE);
  const publishing = shipped
    ? []
    : [
        `${name} doesn't ship its ${MANIFEST_FILE}: add it to \`files\`, \`npm pkg set 'files=${JSON.stringify([...(Array.isArray(entry.files) ? entry.files : []), MANIFEST_FILE])}' --json -w ${entry.dir}\``,
      ];

  if (!found.exists) {
    return [
      `${name} has no ${MANIFEST_FILE}: every extension declares itself in ${entry.dir}/${MANIFEST_FILE}, starting with \`{ "name": "${path.posix.basename(entry.dir)}" }\``,
      ...publishing,
    ];
  }

  if (found.unreadable) {
    return [
      `${name}'s ${MANIFEST_FILE} cannot be read (${found.error}): it must be a regular file of strict JSON that the check can open`,
      ...publishing,
    ];
  }

  if (found.error !== undefined) {
    return [
      `${name}'s ${MANIFEST_FILE} is not valid JSON (${found.error}): it is strict JSON, no comments or trailing commas`,
      ...publishing,
    ];
  }

  return [...dataProblems({ name, entry, layout, data: found.data }), ...publishing];
}
