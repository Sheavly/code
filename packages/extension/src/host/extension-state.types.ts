import type { EXTENSION_STATES } from './extension-state.constants.js';

/** Where one extension is in the host: see `EXTENSION_TRANSITIONS`. */
export type ExtensionState = (typeof EXTENSION_STATES)[number];

/**
 * One extension's state with what only some states hold: the tool names the manifest check
 * recorded exist from `verified` until the extension ends, and never in another state.
 */
export type ExtensionLife =
  | { state: Exclude<ExtensionState, 'verified' | 'merged'> }
  | { state: 'verified' | 'merged'; tools: readonly string[] };
