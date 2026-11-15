import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Environment } from '@sheavly/core/environment/environment.types';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { WorkspaceError } from '../errors/workspace.errors.js';
import type { Workspace } from '../workspace/workspace.service.js';
import { assertWorkTree, checkedOutBranch } from './checkout.helper.js';
import type { WorkingRootInfo, WorkingRootState, WorkingRootStore } from './working-root.types.js';
import { parseShellState } from './working-root.validator.js';

/**
 * The folder one conversation's agents work from, kept in its `shell.json` so the main session
 * and its sub-agents share it and it survives a restart. It never moves the user's shell or this
 * process: it is only the base the agents' relative paths and command folders resolve against.
 * The folder must be one the workspace can reach (its root, scratch or a verified sibling
 * worktree) and a git work tree, so choosing a root never widens what the agents may touch.
 *
 * Nothing is cached. Every call reads the store, so a change by one agent is seen by the rest at
 * once. A root whose folder is gone is reported (`state`) and makes `get` throw: a relative path
 * must never quietly start somewhere else, such as the main checkout.
 */
export class WorkingRoots {
  readonly #store: WorkingRootStore;
  readonly #workspace: Workspace;
  readonly #env: Environment;

  constructor(params: { store: WorkingRootStore; workspace: Workspace; env: Environment }) {
    this.#store = params.store;
    this.#workspace = params.workspace;
    this.#env = params.env;
  }

  /** What is stored, and whether its folder can still be used. */
  async state(): Promise<WorkingRootState> {
    const { workingRoot } = parseShellState((await this.#store.load()) ?? {});

    if (workingRoot === undefined) return { kind: 'unset' };

    try {
      const real = await this.#usable(workingRoot);

      return { kind: 'set', info: { root: real, branch: await this.#branch(real) } };
    } catch (caughtError) {
      // Only a refusal about the folder (gone, no longer reachable, no longer a work tree) is a
      // root that went bad; any other failure is not ours to hide.
      if (caughtError instanceof WorkspaceError) {
        return { kind: 'gone', root: workingRoot, reason: caughtError.message };
      }

      throw caughtError;
    }
  }

  /**
   * The current root and its branch, or `undefined` when none is set. Throws a `WorkspaceError`
   * telling the agent to set another when the stored root can no longer be used. It asks git for
   * the branch, so a tool call that only needs the folder uses `root` instead.
   */
  async get(): Promise<WorkingRootInfo | undefined> {
    const state = await this.state();

    if (state.kind === 'gone') throw goneError(state);

    return state.kind === 'set' ? state.info : undefined;
  }

  /**
   * Just the folder, for the check every tool call makes: it must still be a folder the workspace
   * reaches and a git work tree (one `rev-parse`, no branch lookup), so `root` and `get` agree on
   * what a usable root is. Throws as `get` does when it is not, so a relative path never quietly
   * starts somewhere else. `undefined` when none is set.
   */
  async root(): Promise<string | undefined> {
    const { workingRoot } = parseShellState((await this.#store.load()) ?? {});

    if (workingRoot === undefined) return undefined;

    try {
      return await this.#usable(workingRoot);
    } catch (caughtError) {
      if (caughtError instanceof WorkspaceError) {
        throw goneError({ root: workingRoot, reason: caughtError.message });
      }

      throw caughtError;
    }
  }

  /**
   * Makes `requested` the working root. It must be reachable by the workspace, an existing folder
   * and a git work tree; otherwise a `WorkspaceError` says which. The branch comes from git, never
   * from the caller. `check` sees the real folder before anything is stored and may refuse it by
   * throwing, as the coding tools' `.env` guard does.
   */
  async set(
    requested: string,
    options: { check?: (real: string) => void } = {},
  ): Promise<WorkingRootInfo> {
    const real = await this.#reachableFolder(path.resolve(this.#workspace.root, requested));

    // Before git looks at it: a folder about to be refused is never handed to a git process.
    options.check?.(real);
    const root = await this.#usable(real);
    const info: WorkingRootInfo = { root, branch: await this.#branch(root) };

    await this.#store.update((current) => withRoot({ current, workingRoot: info.root }));

    return info;
  }

  /** Unsets the root: paths resolve against the workspace root again. */
  async clear(): Promise<void> {
    await this.#store.update((current) => withRoot({ current, workingRoot: undefined }));
  }

  /**
   * The one definition of a usable root: a folder the workspace reaches that is a git work tree.
   * `state`, `root` and `set` all decide through it; throws a `WorkspaceError` when it is not.
   */
  async #usable(dir: string): Promise<string> {
    const real = await this.#reachableFolder(dir);

    await assertWorkTree({ dir: real, env: this.#env });

    return real;
  }

  /** The branch checked out in a folder already known to be usable. */
  #branch(real: string): Promise<string | undefined> {
    return checkedOutBranch({ dir: real, env: this.#env });
  }

  /**
   * The real path of `dir`, which must be a folder the workspace reaches. The reachability check
   * comes first, so what is outside the workspace is refused the same way whether it exists or not.
   */
  async #reachableFolder(dir: string): Promise<string> {
    let real: string;

    try {
      real = await this.#workspace.resolveRead(dir);
    } catch (caughtError) {
      if (!isMissingPath(caughtError)) throw caughtError;
      throw new WorkspaceError(`${dir} does not exist`, { cause: caughtError });
    }

    if (!(await stat(real)).isDirectory()) throw new WorkspaceError(`${dir} is not a folder`);

    return real;
  }
}

/** The error for a stored root that can no longer be used, telling the agent what to do. */
function goneError(gone: { root: string; reason: string }): WorkspaceError {
  return new WorkspaceError(
    `The working root ${gone.root} can no longer be used (${gone.reason}). Call set_working_root with a folder, or without a path to go back to the workspace root.`,
  );
}

/** The document with its working root set or removed, and everything else in it kept. */
function withRoot(params: { current: unknown; workingRoot: string | undefined }): object {
  const { current, workingRoot } = params;
  const document: Record<string, unknown> = isRecord(current) ? current : {};
  const { workingRoot: _previous, ...rest } = document;

  return workingRoot === undefined ? rest : { ...rest, workingRoot };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
