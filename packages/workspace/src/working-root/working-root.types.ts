/**
 * Where a conversation's working root is kept. `@sheavly/storage`'s `DocumentFile` fits: `load`
 * gives what is stored (`undefined` when nothing is), `update` replaces it one change at a time.
 */
export type WorkingRootStore = {
  load: () => Promise<unknown>;
  update: (change: (current: unknown) => unknown) => Promise<void>;
};

/** What is stored, and whether the stored folder can still be used. */
export type WorkingRootState =
  | { kind: 'unset' }
  | { kind: 'set'; info: WorkingRootInfo }
  | { kind: 'gone'; root: string; reason: string };

/** The checkout a working root points at. */
export type WorkingRootInfo = {
  /** Canonical absolute path of the working root. */
  root: string;
  /** The checked-out branch, or `undefined` on a detached HEAD. */
  branch: string | undefined;
};
