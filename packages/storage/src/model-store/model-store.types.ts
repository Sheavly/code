import type { Model } from '@sheavly/protocol/model/model.types';
import type { FileProblem } from '../listing/listing.types.js';

/**
 * What a profile's models folder holds: the models that read cleanly (by name, then id, so the
 * order is the same on every system), and a problem for each file that did not.
 */
export type ModelListing = {
  models: Model[];
  problems: FileProblem[];
};
