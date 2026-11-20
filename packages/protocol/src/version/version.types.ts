import type { z } from 'zod';
import type { protocolVersionSchema, serverVersionSchema } from './version.validator.js';

/** A semantic version as a protocol version carries it: a string of that grammar. */
export type ProtocolVersion = z.infer<typeof protocolVersionSchema>;

/** A server's own version: a semantic version string. */
export type ServerVersion = z.infer<typeof serverVersionSchema>;

/** Whether a client and a server speak the same protocol; when not, which side is older. */
export type ProtocolCheck =
  | { match: true }
  | {
      match: false;
      older: 'client' | 'server';
      client: ProtocolVersion;
      server: ProtocolVersion;
      message: string;
    };
