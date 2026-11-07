import type { Model, ModelFile } from './model.types.js';

/**
 * Splits the file's identity and pricing metadata from the adapter's own definition, so no
 * hosting backend receives envelope fields as configuration.
 */
export function toModel(file: ModelFile): Model {
  const { id, name, adapter, pricing, identity, ...definition } = file;

  return {
    id,
    name,
    adapter,
    definition,
    ...(pricing && { pricing }),
    ...(identity && { identity }),
  };
}

/**
 * A model as its file holds it: the inverse of `toModel`. The envelope comes last, so a
 * definition can't overwrite the model's own id, name or adapter, or supply optional metadata.
 */
export function toModelFile(model: Model): ModelFile {
  const { identity: _identity, pricing: _pricing, ...definition } = model.definition;

  return {
    ...definition,
    id: model.id,
    name: model.name,
    adapter: model.adapter,
    ...(model.pricing && { pricing: model.pricing }),
    ...(model.identity && { identity: model.identity }),
  };
}

/**
 * Whether `stem` (a model file's name without `.json`) is the id its file says it has. A file
 * that was copied or renamed by hand has an id that isn't its name; serving it would let two
 * files claim one model, so it is refused.
 */
export function fileIsNamedForItsId(params: { stem: string; file: ModelFile }): boolean {
  return params.file.id === params.stem;
}
