import { readdir, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { now } from '@sheavly/core/clock/clock.helper';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { TrustStoreError } from '../errors/trust.errors.js';
import { SHEAVLY_DIR } from '../project-hooks/project-hooks.constants.js';
import { TRUST_STORE_VERSION } from './trust.constants.js';
import type {
  FingerprintEntry,
  TrustPersistence,
  TrustState,
  TrustStoreData,
} from './trust.types.js';
import { fingerprintOf, olderFormatHint } from './trust.utils.js';
import { trustStoreSchema } from './trust.validator.js';
import { isInside } from '../workspace/workspace.utils.js';

/**
 * Which workspaces the user trusts to run their `.sheavly/` hooks. Kept in one JSON file
 * outside every repo (the host picks it, e.g. `~/.config/sheavly/trusted-workspaces.json`), so a
 * repo can't mark itself trusted. Each entry is the workspace's real path and a fingerprint of
 * its `.sheavly/` folder when it was trusted: any later change to that folder makes it `changed`,
 * so new hook code never runs on an old "yes".
 *
 * The harness never asks: a host asks the user its own way (or takes a `--trust` flag) and
 * calls `trust`.
 */
export class TrustStore {
  readonly #persistence: TrustPersistence;

  constructor(params: { persistence: TrustPersistence }) {
    this.#persistence = params.persistence;
  }

  /** Whether `root`'s project hooks may run (see `TrustState`). */
  async check(params: { root: string }): Promise<TrustState> {
    const root = await realpath(params.root);

    await this.#assertOutside(root);

    const entry = this.#parse(await this.#guarded(() => this.#persistence.load())).workspaces[root];

    if (!entry) return 'untrusted';

    return entry.fingerprint === (await fingerprintWorkspace({ root })) ? 'trusted' : 'changed';
  }

  /** Trusts `root` as its `.sheavly/` is now; a later change makes it `changed` again. */
  async trust(params: { root: string }): Promise<void> {
    const root = await realpath(params.root);

    await this.#assertOutside(root);

    // Fingerprinted before the change, which runs inside the persistence's one-at-a-time turn.
    const entry = { fingerprint: await fingerprintWorkspace({ root }), trustedAt: now() };

    await this.#guarded(() =>
      this.#persistence.update((current) => {
        const store = this.#parse(current);

        return { ...store, workspaces: { ...store.workspaces, [root]: entry } };
      }),
    );
  }

  /** Forgets `root`: its project hooks don't run until it is trusted again. */
  async revoke(params: { root: string }): Promise<void> {
    const root = await realpath(params.root);

    await this.#guarded(() =>
      this.#persistence.update((current) => {
        const store = this.#parse(current);

        // Nothing to forget: returning nothing leaves the store as it is.
        if (!(root in store.workspaces)) return undefined;

        return {
          ...store,
          workspaces: Object.fromEntries(
            Object.entries(store.workspaces).filter(([trusted]) => trusted !== root),
          ),
        };
      }),
    );
  }

  /**
   * A store inside the workspace could ship with the repo and trust it: refused. Checked on the
   * real path of the store's folder, so a symlink out of the repo is fine and one in isn't.
   */
  async #assertOutside(root: string): Promise<void> {
    const folder = await realFolder(path.dirname(path.resolve(this.#persistence.file)));

    if (isInside({ folder: root, target: folder })) {
      throw new TrustStoreError({
        file: this.#persistence.file,
        cause: undefined,
        reason: `it is inside the workspace ${root}, so the repo could trust itself. Keep it outside every repo (SHEAVLY_TRUST_FILE).`,
      });
    }
  }

  /** The stored document as a store; none stored means nothing is trusted. */
  #parse(stored: unknown): TrustStoreData {
    if (stored === undefined) return { version: TRUST_STORE_VERSION, workspaces: {} };

    return parseOrThrow({
      schema: trustStoreSchema,
      input: stored,
      onInvalid: ({ details, error }) =>
        new TrustStoreError({
          file: this.#persistence.file,
          cause: error,
          reason: `invalid:\n${details}${olderFormatHint(stored)}`,
        }),
    });
  }

  /** Runs a persistence call, and reports a failure of its own as a `TrustStoreError` naming the file. */
  async #guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (caughtError) {
      if (caughtError instanceof TrustStoreError) throw caughtError;
      throw new TrustStoreError({ file: this.#persistence.file, cause: caughtError });
    }
  }
}

/**
 * The fingerprint of `root`'s `.sheavly/` folder: every file in it, at any depth, by path and
 * content. A symlink counts by where it points (it isn't followed). No folder hashes as empty.
 */
export async function fingerprintWorkspace(params: { root: string }): Promise<string> {
  const dir = path.join(params.root, SHEAVLY_DIR);
  let found;

  try {
    found = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return fingerprintOf([]);
    throw caughtError;
  }

  const entries: FingerprintEntry[] = [];

  for (const entry of found) {
    if (entry.isDirectory()) continue;

    const full = path.join(entry.parentPath, entry.name);
    const relative = path.relative(dir, full).split(path.sep).join('/');
    const content = entry.isSymbolicLink()
      ? `symlink:${await readlink(full)}`
      : await readFile(full);

    entries.push({ path: relative, content });
  }

  return fingerprintOf(entries);
}

/** The real path of `dir`, or of its nearest existing ancestor with the rest re-appended. */
async function realFolder(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch (caughtError) {
    if (!isMissingPath(caughtError) || path.dirname(dir) === dir) throw caughtError;

    return path.join(await realFolder(path.dirname(dir)), path.basename(dir));
  }
}
