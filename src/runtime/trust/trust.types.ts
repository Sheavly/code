import type { z } from 'zod';
import type { trustStoreSchema } from './trust.utils.js';

/** The trust store file, after validation. */
export type TrustStoreData = z.infer<typeof trustStoreSchema>;

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
