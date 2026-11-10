/** `pruneScratch` could not remove one or more stale entries; the others were still removed. */
export class ScratchPruneError extends Error {
  override name = 'ScratchPruneError';
  /** The entries that could not be removed, with the reason for each. */
  readonly failures: readonly { path: string; cause: unknown }[];

  constructor(failures: readonly { path: string; cause: unknown }[]) {
    const what =
      failures.length === 1 ? 'a stale scratch entry' : `${failures.length} stale scratch entries`;

    super(`Could not remove ${what}: ${failures.map((f) => f.path).join(', ')}`);
    this.failures = failures;
  }
}
