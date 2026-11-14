import type { STATUS_TABLE } from './status.constants.js';

/** A machine with a row in the status table. */
export type Machine = keyof typeof STATUS_TABLE;

/** The states of one machine, as its table lists them. */
export type StateOf<M extends Machine> = Extract<keyof (typeof STATUS_TABLE)[M], string>;
