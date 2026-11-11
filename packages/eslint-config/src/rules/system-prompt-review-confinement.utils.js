import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Private to this inventory boundary; no shared discovery or product error policy changes.
class PromptReviewInventoryError extends Error {
  constructor(params) {
    const { problem, file, cause } = params;

    super(`${problem}: ${file}`, { cause });
    this.name = 'PromptReviewInventoryError';
    this.path = file;
  }
}

function inspect(file) {
  try {
    return lstatSync(file);
  } catch (caughtError) {
    // Missing valid workspace folders and manifests match nothing.
    if (caughtError.code === 'ENOENT' || caughtError.code === 'ENOTDIR') return null;

    throw new PromptReviewInventoryError({
      problem: 'Cannot inspect inventory path',
      file,
      cause: caughtError,
    });
  }
}

/** Checks every ancestor before accessing metadata; each supplied root is independent. */
export function inventoryPath(params) {
  const { root, file, skipLinks = false } = params;
  const relative = path.relative(root, file);

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new PromptReviewInventoryError({
      problem: 'Inventory path escapes workspace root',
      file,
    });
  }

  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;

  for (const part of absolute.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    const entry = inspect(current);

    if (!entry) return null;

    if (entry.isSymbolicLink()) {
      if (skipLinks && current !== root && current === absolute) return null;

      throw new PromptReviewInventoryError({
        problem: 'Symlinked inventory path is not allowed',
        file: current,
      });
    }
  }

  return inspect(absolute);
}

/** Reads only confined, non-symlink metadata and never exposes JSON contents in errors. */
export function inventoryManifest(params) {
  const { root, dir } = params;
  const file = path.join(dir, 'package.json');

  if (!inventoryPath({ root, file })) return null;

  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (caughtError) {
    throw new PromptReviewInventoryError({
      problem: 'Cannot read inventory manifest',
      file,
      cause: caughtError,
    });
  }
}

function patternDirectories(params) {
  const { root, pattern } = params;

  if (
    typeof pattern !== 'string' ||
    path.isAbsolute(pattern) ||
    pattern.split(/[\\/]/).includes('..')
  ) {
    throw new PromptReviewInventoryError({
      problem: 'Unsafe inventory workspace pattern',
      file: typeof pattern === 'string' ? pattern : path.join(root, 'package.json'),
    });
  }

  const wildcard = pattern.endsWith('/*');
  const dir = path.resolve(root, wildcard ? pattern.slice(0, -2) : pattern);
  const entry = inventoryPath({ root, file: dir });

  if (!entry?.isDirectory()) return [];
  if (!wildcard) return [dir];

  return readdirSync(dir, { withFileTypes: true })
    .filter((child) => child.isDirectory())
    .map((child) => path.join(dir, child.name));
}

/** Matches the shared discovery patterns without its unconfined metadata reads. */
export function inventoryWorkspaceDirs(suppliedRoot) {
  const root = path.resolve(suppliedRoot);
  const manifest = inventoryManifest({ root, dir: root });

  if (!Array.isArray(manifest?.workspaces)) {
    throw new PromptReviewInventoryError({
      problem: 'Missing inventory workspace patterns',
      file: path.join(root, 'package.json'),
    });
  }

  const dirs = manifest.workspaces.flatMap((pattern) => patternDirectories({ root, pattern }));
  const src = inventoryPath({ root, file: path.join(root, 'src'), skipLinks: true });

  return [...(src?.isDirectory() ? [root] : []), ...dirs].filter((dir) =>
    inventoryPath({ root, file: path.join(dir, 'package.json') }),
  );
}

/** Root lookup for this rule only: reject symlinked metadata before any read. */
export function findPromptReviewRoot(cwd) {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const manifest = inventoryManifest({ root: dir, dir });

    if (Array.isArray(manifest?.workspaces)) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}
