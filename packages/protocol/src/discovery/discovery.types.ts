import type { z } from 'zod';
import type { discoveryFileSchema } from './discovery.validator.js';

export type DiscoveryFile = z.infer<typeof discoveryFileSchema>;

/**
 * What `peekFormatVersion` finds: the format this code reads (`current`, still to be checked in
 * full), a later one (`newer`, with its number) or no format this code knows.
 */
export type DiscoveryFormatPeek =
  { status: 'current' } | { status: 'newer'; formatVersion: number } | { status: 'unreadable' };
