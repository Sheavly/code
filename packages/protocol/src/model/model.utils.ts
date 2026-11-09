import { CONTEXT_WINDOW_CHOICES } from './model.constants.js';
import type { Model, ModelFile } from './model.types.js';

/**
 * Splits the file's identity and pricing metadata from the adapter's own definition, so no
 * hosting backend receives envelope fields as configuration.
 */
export function toModel(file: ModelFile): Model {
  const { id, name, adapter, pricing, identity, contextWindow, ...definition } = file;

  return {
    id,
    name,
    adapter,
    definition,
    ...(pricing && { pricing }),
    ...(identity && { identity }),
    ...(contextWindow && { contextWindow }),
  };
}

/**
 * A model as its file holds it: the inverse of `toModel`. The envelope comes last, so a
 * definition can't overwrite the model's own id, name or adapter, or supply optional metadata.
 */
export function toModelFile(model: Model): ModelFile {
  const {
    identity: _identity,
    pricing: _pricing,
    contextWindow: _contextWindow,
    ...definition
  } = model.definition;

  return {
    ...definition,
    id: model.id,
    name: model.name,
    adapter: model.adapter,
    ...(model.pricing && { pricing: model.pricing }),
    ...(model.identity && { identity: model.identity }),
    ...(model.contextWindow && { contextWindow: model.contextWindow }),
  };
}

/**
 * What a UI calls a context size: "300K" or "1M" for the sizes it offers, and the exact count for
 * any other a model was given ("128,000 tokens"), so that size is never shown as something it
 * isn't.
 */
export function contextWindowLabel(size: number): string {
  const choice = CONTEXT_WINDOW_CHOICES.find((candidate) => candidate.size === size);

  return choice ? choice.label : `${size.toLocaleString('en-US')} tokens`;
}

/**
 * Whether `stem` (a model file's name without `.json`) is the id its file says it has. A file
 * that was copied or renamed by hand has an id that isn't its name; serving it would let two
 * files claim one model, so it is refused.
 */
export function fileIsNamedForItsId(params: { stem: string; file: ModelFile }): boolean {
  return params.file.id === params.stem;
}
