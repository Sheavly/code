import type { Model } from '@sheavly/protocol/model/model.types';

/** One model file the store could not use, and why: reported, never hidden, never served. */
export type ModelProblem = {
  /** The file, absolute. */
  file: string;
  message: string;
};

/**
 * What a profile's models folder holds: the models that read cleanly (by name, then id, so the
 * order is the same on every system), and a problem for each file that did not.
 */
export type ModelListing = {
  models: Model[];
  problems: ModelProblem[];
};
