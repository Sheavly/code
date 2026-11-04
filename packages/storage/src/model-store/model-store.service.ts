import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Model, ModelId } from '@sheavly/protocol/model/model.types';
import { fileIsNamedForItsId, toModel, toModelFile } from '@sheavly/protocol/model/model.utils';
import { modelFileSchema, modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { StorageFileError } from '../errors/storage.errors.js';
import { readJsonFile, writeJsonFile } from '../json-file/json-file.helper.js';
import { MODEL_FILE_EXTENSION, MODELS_FOLDER } from './model-store.constants.js';
import type { ModelListing, ModelProblem } from './model-store.types.js';
import { sortModels } from './model-store.utils.js';

/**
 * The models of one profile: `<profile folder>/models/<model-id>.json`, one file each. A model is
 * its id, which is also its file's name, so a copy or a rename by hand is refused and not served
 * under a name that is not its own. A file never holds a key: those live with the profile's
 * credentials.
 *
 * The store knows no adapter, so it cannot tell whether a definition is right: whoever puts a
 * model checks it first (`AdapterRegistry.validateDefinition`, which also refuses a key in it).
 */
export class ModelStore {
  readonly #folder: string;

  /** `folder` is the profile's folder (`<root>/profiles/<profile-id>`), which an app passes in. */
  constructor(params: { folder: string }) {
    this.#folder = path.join(params.folder, MODELS_FOLDER);
  }

  /**
   * Every model in the folder, and a problem for each file that is not one: damaged, not named for
   * its id, or named for no id at all. One bad file never hides the rest, since people edit these
   * by hand. Files that are not `.json` (and hidden ones, which macOS and editors leave behind)
   * are not models and not problems. No folder yet is an empty listing.
   */
  async list(): Promise<ModelListing> {
    const names = await this.#modelFileNames();
    const read = await Promise.all(names.map((name) => this.#readListed(name)));

    return {
      models: sortModels(read.flatMap(({ model }) => (model ? [model] : []))),
      problems: read.flatMap(({ problem }) => (problem ? [problem] : [])),
    };
  }

  /**
   * The model with this id, or `undefined` when there is none. A file that exists but cannot be
   * used (damaged, or its id is not its name) throws a `StorageFileError` naming it: the model
   * was asked for, and it must not look absent.
   */
  async get(id: ModelId): Promise<Model | undefined> {
    return this.#read(id);
  }

  /**
   * Stores `model` as its file, replacing the one with its id. The definition must already be
   * checked and hold no secret (see the class).
   */
  async put(model: Model): Promise<void> {
    await writeJsonFile({ file: this.#fileOf(model.id), value: toModelFile(model) });
  }

  /** Removes the model with this id; none is fine. Its credential is the credentials store's. */
  async remove(id: ModelId): Promise<void> {
    const file = this.#fileOf(id);

    try {
      await rm(file, { force: true });
    } catch (caughtError) {
      throw new StorageFileError({ file, cause: caughtError });
    }
  }

  #fileOf(id: ModelId): string {
    return path.join(this.#folder, `${id}${MODEL_FILE_EXTENSION}`);
  }

  /** The names in the folder that could be models, in a fixed order: `readdir`'s is the system's. */
  async #modelFileNames(): Promise<string[]> {
    let names: string[];

    try {
      names = await readdir(this.#folder);
    } catch (caughtError) {
      if (isMissingPath(caughtError)) return [];
      throw new StorageFileError({ file: this.#folder, cause: caughtError });
    }

    return names
      .filter((name) => name.endsWith(MODEL_FILE_EXTENSION) && !name.startsWith('.'))
      .sort();
  }

  async #read(id: ModelId): Promise<Model | undefined> {
    const file = this.#fileOf(id);
    const stored = await readJsonFile({ file, schema: modelFileSchema });

    if (!stored) return undefined;

    if (!fileIsNamedForItsId({ stem: id, file: stored })) {
      throw new StorageFileError({
        file,
        cause: undefined,
        reason: `it holds the model ${stored.id}, but is named for ${id}: a copy or a rename by hand. Name each file after the id inside it`,
      });
    }

    return toModel(stored);
  }

  /** One file of the listing: its model, or what is wrong with it. Neither: it was removed since. */
  async #readListed(name: string): Promise<{ model?: Model; problem?: ModelProblem }> {
    const file = path.join(this.#folder, name);
    const id = modelIdSchema.safeParse(name.slice(0, -MODEL_FILE_EXTENSION.length));

    if (!id.success) {
      return {
        problem: {
          file,
          message:
            'its name is not a model id. Name the file after the id inside it, a lowercase UUID',
        },
      };
    }

    try {
      const model = await this.#read(id.data);

      return model ? { model } : {};
    } catch (caughtError) {
      // Only a file that cannot be used is a problem to list; any other failure is not ours to hide.
      if (caughtError instanceof StorageFileError) {
        return { problem: { file, message: caughtError.message } };
      }

      throw caughtError;
    }
  }
}
