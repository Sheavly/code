import { mkdir, readdir, readFile, readlink, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { TrustStoreError } from '../errors/trust.errors.js';
import { SHEAVLY_DIR } from '../project-hooks/project-hooks.constants.js';
import { TRUST_STORE_VERSION } from './trust.constants.js';
import type { FingerprintEntry, TrustState, TrustStoreData } from './trust.types.js';
import { fingerprintOf } from './trust.utils.js';
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
  readonly #file: string;

  constructor(params: { file: string }) {
    this.#file = params.file;
  }

  /** Whether `root`'s project hooks may run (see `TrustState`). */
  async check(params: { root: string }): Promise<TrustState> {
    const root = await realpath(params.root);

    await this.#assertOutside(root);

    const entry = (await this.#read()).workspaces[root];

    if (!entry) return 'untrusted';

    return entry.fingerprint === (await fingerprintWorkspace({ root })) ? 'trusted' : 'changed';
  }

  /** Trusts `root` as its `.sheavly/` is now; a later change makes it `changed` again. */
  async trust(params: { root: string }): Promise<void> {
    const root = await realpath(params.root);

    await this.#assertOutside(root);

    const store = await this.#read();

    store.workspaces[root] = {
      fingerprint: await fingerprintWorkspace({ root }),
      trustedAt: new Date().toISOString(),
    };
    await this.#write(store);
  }

  /** Forgets `root`: its project hooks don't run until it is trusted again. */
  async revoke(params: { root: string }): Promise<void> {
    const root = await realpath(params.root);
    const store = await this.#read();

    if (!(root in store.workspaces)) return;

    const workspaces = Object.fromEntries(
      Object.entries(store.workspaces).filter(([trusted]) => trusted !== root),
    );

    await this.#write({ ...store, workspaces });
  }

  /**
   * A store inside the workspace could ship with the repo and trust it: refused. Checked on the
   * real path of the store's folder, so a symlink out of the repo is fine and one in isn't.
   */
  async #assertOutside(root: string): Promise<void> {
    const folder = await realFolder(path.dirname(path.resolve(this.#file)));

    if (isInside({ folder: root, target: folder })) {
      throw new TrustStoreError({
        file: this.#file,
        cause: undefined,
        reason: `it is inside the workspace ${root}, so the repo could trust itself. Keep it outside every repo (SHEAVLY_TRUST_FILE).`,
      });
    }
  }

  /** The store; no file yet means nothing is trusted. Anything else wrong names the file. */
  async #read(): Promise<TrustStoreData> {
    let text: string;

    try {
      text = await readFile(this.#file, 'utf8');
    } catch (caughtError) {
      if (isMissingPath(caughtError)) return { version: TRUST_STORE_VERSION, workspaces: {} };
      throw new TrustStoreError({ file: this.#file, cause: caughtError });
    }

    let json: unknown;

    try {
      json = JSON.parse(text);
    } catch (caughtError) {
      throw new TrustStoreError({ file: this.#file, cause: caughtError });
    }

    return parseOrThrow({
      schema: trustStoreSchema,
      input: json,
      onInvalid: ({ details, error }) =>
        new TrustStoreError({ file: this.#file, cause: error, reason: `invalid:\n${details}` }),
    });
  }

  /** Written to a temp file and renamed into place, so a crash never leaves half a store. */
  async #write(store: TrustStoreData): Promise<void> {
    const temp = `${this.#file}.${process.pid}.tmp`;

    try {
      await mkdir(path.dirname(this.#file), { recursive: true });
      await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, this.#file);
    } catch (caughtError) {
      throw new TrustStoreError({ file: this.#file, cause: caughtError });
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
