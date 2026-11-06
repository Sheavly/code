import path from 'node:path';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import { assertPrivateFile, readJsonFile, writeJsonFile } from '../json-file/json-file.helper.js';
import { assertSafeRoot } from '../safe-path/safe-path.helper.js';
import { SerialQueue } from '../serial-queue/serial-queue.service.js';
import { CREDENTIALS_FILE } from './credential-store.constants.js';
import type { Secrets } from './credential-store.types.js';
import { credentialsFileSchema } from './credential-store.validator.js';

/**
 * A profile's secrets: `<profile folder>/credentials.json`, each model's by its id. The only file
 * that holds keys, and kept to the user alone: always written private, and a file found open to
 * others is refused (see `assertPrivateFile`) before a key is read from it.
 *
 * Nothing here ever puts a key in an error: a file that is not JSON is reported without its text,
 * and a file that is not the right shape is named by field path only.
 *
 * Writes go one after the other: setting a key reads the whole file and writes it back, so two at
 * once would each start from the same file and the second would erase the first's key.
 */
export class CredentialStore {
  readonly #file: string;
  readonly #writes = new SerialQueue();

  /** `folder` is the profile's folder (`<root>/profiles/<profile-id>`), which an app passes in. */
  constructor(params: { folder: string }) {
    this.#file = path.join(assertSafeRoot(params.folder), CREDENTIALS_FILE);
  }

  /** The secrets of model `id`, or `undefined` when it has none. */
  async get(id: ModelId): Promise<Secrets | undefined> {
    return (await this.#readAll())[id];
  }

  /**
   * Which models have secrets, and the names of the fields, never their values: what a UI shows to
   * say "a key is set" without a way to read it back.
   */
  async fieldsSet(): Promise<Record<string, string[]>> {
    const all = await this.#readAll();

    return Object.fromEntries(
      Object.entries(all).map(([id, secrets]) => [id, Object.keys(secrets)]),
    );
  }

  /** Sets model `id`'s secrets, replacing the ones it had. */
  async put(params: { id: ModelId; secrets: Secrets }): Promise<void> {
    const { id, secrets } = params;

    await this.#change((all) => ({ ...all, [id]: secrets }));
  }

  /** Forgets model `id`'s secrets; none is fine. */
  async remove(id: ModelId): Promise<void> {
    await this.#change((all) =>
      Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)),
    );
  }

  async #readAll(): Promise<Record<string, Secrets>> {
    await assertPrivateFile({ file: this.#file });

    return (
      (await readJsonFile({
        file: this.#file,
        schema: credentialsFileSchema,
        holdsSecrets: true,
      })) ?? {}
    );
  }

  /** Reads, changes and writes the file as one step, after the steps before it. */
  #change(update: (all: Record<string, Secrets>) => Record<string, Secrets>): Promise<void> {
    return this.#writes.run(async () => {
      await writeJsonFile({ file: this.#file, value: update(await this.#readAll()) });
    });
  }
}
