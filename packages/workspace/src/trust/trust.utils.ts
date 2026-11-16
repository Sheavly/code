import { createHash } from 'node:crypto';
import { FINGERPRINT_ALGORITHM, TRUST_STORE_VERSION } from './trust.constants.js';
import type { FingerprintEntry, TrustState } from './trust.types.js';

/** A trusted workspace is `trusted` while `.sheavly/` still hashes to its stored fingerprint, `changed` after. */
export function compareFingerprints(params: {
  trustedFingerprint: string;
  currentFingerprint: string;
}): 'trusted' | 'changed' {
  return params.trustedFingerprint === params.currentFingerprint ? 'trusted' : 'changed';
}

/**
 * The decision of the trust state machine: a workspace with no stored fingerprint is
 * `untrusted`; with one, `compareFingerprints` says. `TrustStore` derives every state here.
 * `currentFingerprint` hashes `.sheavly/` and is called only when there is a stored fingerprint
 * to compare, so an untrusted workspace's folder is never read. Nothing stops another caller
 * comparing fingerprints itself, so review keeps it that way.
 */
export async function decideTrust(params: {
  trustedFingerprint: string | undefined;
  currentFingerprint: () => Promise<string>;
}): Promise<TrustState> {
  const { trustedFingerprint, currentFingerprint } = params;

  if (trustedFingerprint === undefined) return 'untrusted';

  return compareFingerprints({
    trustedFingerprint,
    currentFingerprint: await currentFingerprint(),
  });
}

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
