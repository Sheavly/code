import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FINGERPRINT_ALGORITHM, TRUST_STORE_VERSION } from './trust.constants.js';
import type { FingerprintEntry } from './trust.types.js';

/** The trust store: each trusted workspace (by real path) and the fingerprint it was trusted at. */
export const trustStoreSchema = z.strictObject({
  version: z.literal(TRUST_STORE_VERSION),
  workspaces: z.record(
    z.string(),
    z.strictObject({
      fingerprint: z.string().min(1),
      trustedAt: z.iso.datetime(),
    }),
  ),
});

/**
 * One hash over every file under `.sheavly/`, in path order: each path and its content, each
 * prefixed with its length so no two different folders can hash the same. Adding, removing,
 * renaming or editing any file changes it.
 */
export function fingerprintOf(entries: readonly FingerprintEntry[]): string {
  const hash = createHash(FINGERPRINT_ALGORITHM);
  // Byte order, not locale order, so the hash is the same on every machine.
  const sorted = [...entries].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
  );

  for (const { path, content } of sorted) {
    const bytes = typeof content === 'string' ? Buffer.from(content) : content;

    hash.update(`${Buffer.byteLength(path)}:${path}:${bytes.length}:`);
    hash.update(bytes);
  }

  return `${FINGERPRINT_ALGORITHM}:${hash.digest('hex')}`;
}
