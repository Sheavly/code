import type { KeyCheck } from '@sheavly/protocol/model/model.types';

/** One thing wrong with a model's definition: the field it is about, and what is wrong. */
export type DefinitionProblem = {
  /** The field's name, a path (`request.retries`) for a nested one, or `(model)` for the whole. */
  field: string;
  message: string;
};

/**
 * A provider whose refusals mean more than the status says, so its check explains them in its own
 * terms. Other adapters get the general messages.
 */
export type CheckHost = 'bedrock';

/** A check that did not end `valid`: the status it ended with. */
export type FailedCheck = Exclude<KeyCheck['status'], 'valid'>;
