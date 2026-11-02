import { z } from 'zod';
import { TRUST_STORE_VERSION } from './trust.constants.js';

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
