import type { Model, ModelFile } from './model.types.js';

/**
 * A model file read once into the model every other part of the system holds: its id, name and
 * adapter, and everything past those, the adapter's own definition.
 */
export function toModel(file: ModelFile): Model {
  const { id, name, adapter, ...definition } = file;

  return { id, name, adapter, definition };
}

/**
 * A model as its file holds it: the inverse of `toModel`. The envelope comes last, so a
 * definition can't overwrite the model's own id, name or adapter.
 */
export function toModelFile(model: Model): ModelFile {
  return { ...model.definition, id: model.id, name: model.name, adapter: model.adapter };
}

/**
 * Whether `stem` (a model file's name without `.json`) is the id its file says it has. A file
 * that was copied or renamed by hand has an id that isn't its name; serving it would let two
 * files claim one model, so it is refused.
 */
export function fileIsNamedForItsId(params: { stem: string; file: ModelFile }): boolean {
  return params.file.id === params.stem;
}
