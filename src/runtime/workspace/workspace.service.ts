import type { Stats } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { PathCheckError, WorkspaceError } from '../errors/workspace.errors.js';
import { isMissingPath } from '../errors/errors.utils.js';

/**
 * The directory the agent is confined to. Every file tool resolves paths through
 * `resolveRead` / `resolveWrite`, which reject anything that ends up outside the root:
 * absolute paths, `../` tricks, and symlinks (to files or directories) that point out.
 */
export class Workspace {
  private constructor(
    /** Canonical (symlink-free) absolute path of the workspace root. */
    readonly root: string,
  ) {}

  /** Opens a workspace. Defaults to the current working directory. */
  static async open(root: string = process.cwd()): Promise<Workspace> {
    const real = await realpath(path.resolve(root));

    if (!(await stat(real)).isDirectory()) {
      throw new WorkspaceError(`Workspace root is not a directory: ${root}`);
    }

    return new Workspace(real);
  }

  /** Resolves an existing file for reading. Returns its real path inside the workspace. */
  async resolveRead(requested: string): Promise<string> {
    const lexical = this.assertInside(path.resolve(this.root, requested), requested);

    // Follows every symlink. Missing stays an ENOENT (callers say "not found"); any other
    // failure is a PathCheckError: the path couldn't be checked, which is never "fine".
    return this.assertInside(await checked({ requested, run: () => realpath(lexical) }), requested);
  }

  /**
   * Resolves a path for writing. The file may not exist yet, so we canonicalize the
   * closest existing ancestor and check that instead.
   */
  async resolveWrite(requested: string): Promise<string> {
    const lexical = this.assertInside(path.resolve(this.root, requested), requested);

    const existing = await lstatIfExists({ file: lexical, requested });

    if (existing?.isSymbolicLink()) {
      return this.assertInside(await realSymlinkTarget({ lexical, requested }), requested);
    }

    if (existing) {
      return this.assertInside(
        await checked({ requested, run: () => realpath(lexical) }),
        requested,
      );
    }

    // Walk up to the nearest directory that exists, canonicalize it, re-append the rest.
    let ancestor = path.dirname(lexical);

    while (!(await lstatIfExists({ file: ancestor, requested }))) ancestor = path.dirname(ancestor);
    const realAncestor = await checked({ requested, run: () => realpath(ancestor) });

    return this.assertInside(path.join(realAncestor, path.relative(ancestor, lexical)), requested);
  }

  /** Paths are shown relative to the root in tool output, e.g. `src/index.ts`. */
  relative(absolute: string): string {
    return path.relative(this.root, absolute) || '.';
  }

  private assertInside(absolute: string, requested: string): string {
    const rel = path.relative(this.root, absolute);
    const outside = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);

    if (outside) {
      throw new WorkspaceError(
        `Path is outside the workspace: ${requested} (workspace: ${this.root})`,
      );
    }

    return absolute;
  }
}

/** Runs a filesystem check; a failure other than "missing" becomes a `PathCheckError`. */
async function checked<T>(params: { requested: string; run: () => Promise<T> }): Promise<T> {
  const { requested, run } = params;

  try {
    return await run();
  } catch (caughtError) {
    if (isMissingPath(caughtError)) throw caughtError;
    throw new PathCheckError({ path: requested, cause: caughtError });
  }
}

/** The path's own stats (not a symlink's target), or undefined if it isn't there. */
async function lstatIfExists(params: {
  file: string;
  requested: string;
}): Promise<Stats | undefined> {
  const { file, requested } = params;

  try {
    return await lstat(file);
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return undefined;
    throw new PathCheckError({ path: requested, cause: caughtError });
  }
}

/** Where a symlink really points. A broken one is refused: writing would create its target. */
async function realSymlinkTarget(params: { lexical: string; requested: string }): Promise<string> {
  const { lexical, requested } = params;

  try {
    return await realpath(lexical);
  } catch (caughtError) {
    if (!isMissingPath(caughtError)) {
      throw new PathCheckError({ path: requested, cause: caughtError });
    }

    throw new WorkspaceError(`Refusing to write through a broken symlink: ${requested}`, {
      cause: caughtError,
    });
  }
}
