import type { z } from 'zod';
import type { trustStoreSchema } from './trust.validator.js';

/** The trust store file, after validation. */
export type TrustStoreData = z.infer<typeof trustStoreSchema>;

/**
 * Where the trust store is kept, which the host supplies so that this package knows nothing about
 * files in the user's folder. It moves the document as it is, with no schema: what is in it is the
 * trust store's to check. Any failure it throws is reported as a `TrustStoreError` naming `file`.
 */
export type TrustPersistence = {
  /** Where the document lives, for refusing a place inside the workspace and for errors. */
  readonly file: string;
  /** The stored document, or `undefined` when nothing is stored yet. */
  load(): Promise<unknown>;
  /**
   * Replaces the document with what `change` makes of the current one (`undefined` when nothing
   * is stored). Returning `undefined` stores nothing. Changes must not overlap: each sees the one
   * before it, so two `trust` calls sent together can't erase each other.
   */
  update(change: (current: unknown) => unknown): Promise<void>;
};

/** One file under `.sheavly/`, as fingerprinted: its path there and what it holds. */
export type FingerprintEntry = {
  /** Relative to `.sheavly/`, `/`-separated. */
  path: string;
  /** The file's bytes, or a symlink's target. */
  content: Buffer | string;
};

/**
 * Whether a workspace's project hooks may run:
 * - `trusted`: the user trusted it, and `.sheavly/` is unchanged since.
 * - `untrusted`: it was never trusted.
 * - `changed`: it was trusted, but `.sheavly/` changed since, so it must be trusted again.
 */
export type TrustState = 'trusted' | 'untrusted' | 'changed';
