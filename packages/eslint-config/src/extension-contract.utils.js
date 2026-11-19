// The contract `@sheavly/extension` hands the built-in extensions, read from the files that define
// it so a rule can't drift from it: every name the run-service keys file, the run-service types
// file and the scope errors file export (a declaration, or a re-export such as
// `export type { A } from '…'`), mapped to the package subpath that exposes it. `export * from`
// is not followed: those files list what they re-export by name.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseSource } from './run-service-types.utils.js';

/** The package whose subpaths are the contract. */
export const EXTENSION_PACKAGE = '@sheavly/extension';

const PACKAGE_SRC = 'packages/extension/src/';

/** The files that define the contract, from the repo root; the first to export a name owns it. */
export const CONTRACT_FILES = [
  `${PACKAGE_SRC}run-services/run-services.utils.ts`,
  `${PACKAGE_SRC}run-services/run-services.types.ts`,
  `${PACKAGE_SRC}errors/scopes.errors.ts`,
];

/** What was read per root, with the modification times it was read at. */
const cache = new Map();

/** The import path that exposes `file` (a repo-relative path of `CONTRACT_FILES`). */
function subpathOf(file) {
  return `${EXTENSION_PACKAGE}/${file.slice(PACKAGE_SRC.length).replace(/\.ts$/, '')}`;
}

/** The name a re-export specifier exposes: `export { a as b }` exposes `b`. */
function exposedName(specifier) {
  const { exported } = specifier;

  return exported.type === 'Identifier' ? exported.name : String(exported.value);
}

/** The names one top-level statement exports, or none for anything else. */
function namesExportedBy(statement) {
  if (statement.type !== 'ExportNamedDeclaration') return [];

  const { declaration } = statement;

  if (declaration?.type === 'VariableDeclaration') {
    return declaration.declarations.flatMap((item) =>
      item.id.type === 'Identifier' ? [item.id.name] : [],
    );
  }

  if (declaration?.id?.type === 'Identifier') return [declaration.id.name];

  return statement.specifiers.map(exposedName);
}

/** The path of `file` under `root` when it is a regular file, with its modification time. */
function regularFile(params) {
  const { root, file } = params;
  const full = path.join(root, file);
  const info = statSync(full, { throwIfNoEntry: false });

  return info?.isFile() ? { full, mtimeMs: info.mtimeMs } : undefined;
}

function readContract(found) {
  const names = new Map();

  CONTRACT_FILES.forEach((file, index) => {
    const entry = found[index];
    const ast = entry ? parseSource(readFileSync(entry.full, 'utf8')) : undefined;

    for (const statement of ast?.body ?? []) {
      for (const name of namesExportedBy(statement)) {
        if (!names.has(name)) names.set(name, subpathOf(file));
      }
    }
  });

  return names;
}

/**
 * The contract under `root`: a map from each exported name to the `@sheavly/extension/…` path that
 * exposes it. A file that is missing, not a regular file or has a syntax error adds nothing and
 * is no error, so a throwaway tree yields an empty map. Re-read when any file changes, a failed
 * parse included, so a broken file is not parsed once per linted file.
 */
export function readExtensionContract(root) {
  const found = CONTRACT_FILES.map((file) => regularFile({ root, file }));
  const signature = found.map((entry) => entry?.mtimeMs ?? 'missing').join(':');
  const cached = cache.get(root);

  if (cached?.signature === signature) return cached.names;

  const names = readContract(found);

  cache.set(root, { signature, names });

  return names;
}
