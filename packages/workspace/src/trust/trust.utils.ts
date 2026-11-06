import { createHash } from 'node:crypto';
import { FINGERPRINT_ALGORITHM, TRUST_STORE_VERSION } from './trust.constants.js';
import type { FingerprintEntry } from './trust.types.js';

/**
 * What to add to a refusal when the store on disk is of the previous format: `json` is what was
 * parsed from it. Empty for anything else, so a file that is simply wrong gets no misleading hint.
 */
export function olderFormatHint(json: unknown): string {
  const version = (json as { version?: unknown } | null)?.version;

  if (version !== TRUST_STORE_VERSION - 1) return '';

  return `\nThis store was written by an older version (format ${String(version)}). Delete it and trust each workspace again (--trust): nothing is trusted from a file that can't be read.`;
}

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
