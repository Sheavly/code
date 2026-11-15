import type { Stats } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { PathCheckError, WorkspaceError } from '../errors/workspace.errors.js';
import { openScratchDir, openScratchRoot } from '../scratch/scratch-root.helper.js';
import { isInside } from './workspace.utils.js';
import { findSiblingRoots } from './worktrees.helper.js';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';

/**
 * The directory the agent is confined to. Every file tool resolves paths through
 * `resolveRead` / `resolveWrite` / `resolveDelete`, which reject anything that ends up outside
 * the root:
 * absolute paths, `../` tricks, and symlinks (to files or directories) that point out. The
 * exceptions are the optional scratch root, a shared folder outside the repo for temporary files,
 * and the other git worktrees of the root's repo, so a session in the main checkout can work on
 * an issue's worktree. Nothing else outside the root is reachable.
 */
export class Workspace {
  private constructor(
    /** Canonical (symlink-free) absolute path of the workspace root. */
    readonly root: string,
    /** Canonical absolute path of the shared scratch root, when the app configured one. */
    readonly scratchRoot: string | undefined,
    /** What git runs with when looking for sibling worktrees; without it there are none. */
    private readonly env: Environment | undefined,
  ) {}

  /**
   * Opens a workspace. Defaults to the current working directory. A `scratchRoot` is created
   * (mode `0700`) if missing and canonicalized, so file tools may also reach paths under it. Pass
   * the app's `env` to let the other worktrees of the root's repo count as inside; without it the
   * root is the only one.
   */
  static async open(
    root: string = process.cwd(),
    options: { scratchRoot?: string | undefined; env?: Environment } = {},
  ): Promise<Workspace> {
    const real = await realpath(path.resolve(root));

    if (!(await stat(real)).isDirectory()) {
      throw new WorkspaceError(`Workspace root is not a directory: ${root}`);
    }

    const scratchRoot =
      options.scratchRoot === undefined ? undefined : await openScratchRoot(options.scratchRoot);

    return new Workspace(real, scratchRoot, options.env);
  }

  /**
   * The scratch folder of one top-level agent, created on demand. `agentId` must be a single
   * path segment. Throws if the workspace has no scratch root.
   */
  async scratchDir(agentId: SessionId): Promise<string> {
    if (this.scratchRoot === undefined) {
      throw new WorkspaceError('This workspace has no scratch root');
    }

    if (!isSingleSegment(agentId)) {
      throw new WorkspaceError(`Agent id is not a single path segment: ${agentId}`);
    }

    return openScratchDir({ root: this.scratchRoot, agentId });
  }

  /** Resolves an existing file for reading. Returns its real path inside the workspace. */
  async resolveRead(requested: string): Promise<string> {
    const inside = this.insideCheck(requested);
    const lexical = await inside(path.resolve(this.root, requested));

    // Follows every symlink. Missing stays an ENOENT (callers say "not found"); any other
    // failure is a PathCheckError: the path couldn't be checked, which is never "fine".
    return inside(await checked({ requested, run: () => realpath(lexical) }));
  }

  /**
   * Resolves a path for writing. The file may not exist yet, so we canonicalize the
   * closest existing ancestor and check that instead.
   */
  async resolveWrite(requested: string): Promise<string> {
    const inside = this.insideCheck(requested);
    const lexical = await inside(path.resolve(this.root, requested));

    const existing = await lstatIfExists({ file: lexical, requested });

    if (existing?.isSymbolicLink()) {
      return inside(await realSymlinkTarget({ lexical, requested }));
    }

    if (existing) {
      return inside(await checked({ requested, run: () => realpath(lexical) }));
    }

    // Walk up to the nearest directory that exists, canonicalize it, re-append the rest.
    let ancestor = path.dirname(lexical);

    while (!(await lstatIfExists({ file: ancestor, requested }))) ancestor = path.dirname(ancestor);
    const realAncestor = await checked({ requested, run: () => realpath(ancestor) });

    return inside(path.join(realAncestor, path.relative(ancestor, lexical)));
  }

  /**
   * Resolves an existing file to remove: inside the workspace, and a regular file. A folder is
   * refused, since removing one takes files the caller never named, and so is a symlink,
   * whichever way it points: `lstat` decides, so what a caller may remove is the file's own
   * name, never the target a link names for it.
   */
  async resolveDelete(requested: string): Promise<string> {
    const inside = this.insideCheck(requested);
    const lexical = await inside(path.resolve(this.root, requested));
    // Missing stays an ENOENT (callers say "not found"), as in `resolveRead`.
    const existing = await checked({ requested, run: () => lstat(lexical) });

    if (existing.isSymbolicLink()) {
      throw new WorkspaceError(`Refusing to delete a symlink: ${requested}. Name the file itself.`);
    }

    if (!existing.isFile()) {
      throw new WorkspaceError(`Refusing to delete ${requested}: not a regular file.`);
    }

    // The parent is canonicalized, so a symlinked folder that stays inside still works and the
    // name is checked as the file's own, not through the link.
    const realParent = await checked({ requested, run: () => realpath(path.dirname(lexical)) });

    return inside(path.join(realParent, path.basename(lexical)));
  }

  /**
   * Paths are shown relative to the root in tool output, e.g. `src/index.ts`. A file in scratch
   * stays absolute: that is how the agent reaches it again.
   */
  relative(absolute: string): string {
    if (this.inScratch(absolute) && !isInside({ folder: this.root, target: absolute })) {
      return absolute;
    }

    return path.relative(this.root, absolute) || '.';
  }

  /**
   * Whether `absolute` (a real path) is in the shared scratch root. A path `resolveRead` accepted
   * that is neither in the root nor here is in a verified sibling worktree.
   */
  inScratch(absolute: string): boolean {
    return (
      this.scratchRoot !== undefined && isInside({ folder: this.scratchRoot, target: absolute })
    );
  }

  /**
   * The check for one `resolveRead` / `resolveWrite` / `resolveDelete` call. Worktrees are listed
   * when a path first falls outside the root and kept for the rest of that call only, never
   * across calls: a worktree removed mid-session must stop being reachable, and a new one must
   * start being.
   */
  private insideCheck(requested: string): (absolute: string) => Promise<string> {
    let siblings: Promise<string[]> | undefined;

    return async (absolute) => {
      if (isInside({ folder: this.root, target: absolute }) || this.inScratch(absolute)) {
        return absolute;
      }

      const { env } = this;

      siblings ??= env ? findSiblingRoots({ root: this.root, env }) : Promise.resolve([]);

      if ((await siblings).some((folder) => isInside({ folder, target: absolute }))) {
        return absolute;
      }

      throw new WorkspaceError(`Path is outside the workspace: ${requested}`);
    };
  }
}

function isSingleSegment(name: string): boolean {
  return (
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    path.basename(name) === name &&
    !name.includes('\\')
  );
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
