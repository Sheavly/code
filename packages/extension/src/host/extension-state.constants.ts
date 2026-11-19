/**
 * The states of one extension in a host. `sealed`: known, not reached yet. `activating`: the host
 * is checking, activating or verifying it. `verified`: its contributions are snapshotted and
 * checked against its manifest, but not merged. `merged`: the cross-extension merge passed.
 * The other four are final: `skipped` (never activated), `failed` (its `activate` or its check
 * threw), `rolled-back` (its contributions changed after the check, or it depends on one that
 * did) and `stopped` (the host closed, deactivating it or never running it).
 */
export const EXTENSION_STATES = [
  'sealed',
  'activating',
  'verified',
  'merged',
  'skipped',
  'failed',
  'rolled-back',
  'stopped',
] as const;

/** The one table: each state and the states it may move to. A state with none is final. */
export const EXTENSION_TRANSITIONS = {
  sealed: ['activating'],
  activating: ['verified', 'skipped', 'failed', 'stopped'],
  verified: ['merged', 'rolled-back', 'stopped'],
  merged: ['stopped'],
  skipped: [],
  failed: [],
  'rolled-back': [],
  stopped: [],
} as const satisfies Record<
  (typeof EXTENSION_STATES)[number],
  readonly (typeof EXTENSION_STATES)[number][]
>;
