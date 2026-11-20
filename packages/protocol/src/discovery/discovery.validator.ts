import { z } from 'zod';
import { instanceIdSchema } from '../handshake/handshake.validator.js';
import { protocolVersionSchema, serverVersionSchema } from '../version/version.validator.js';
import {
  DISCOVERY_FORMAT_VERSION,
  DISCOVERY_PLAIN_TEXT_PATTERN,
  DISCOVERY_TOKEN_MAX_CHARS,
  DISCOVERY_TOKEN_MIN_CHARS,
  DISCOVERY_URL_MAX_CHARS,
  DISCOVERY_VERSION_MAX_CHARS,
} from './discovery.constants.js';
import type { DiscoveryFormatPeek } from './discovery.types.js';

/** A client sends the token to this URL, so it is a plain `http:` or `https:` one with no login in it. */
function isPlainHttpUrl(url: string): boolean {
  const parsed = URL.parse(url);

  return (
    parsed !== null &&
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.username === '' &&
    parsed.password === ''
  );
}

/**
 * What a running server writes for the clients on its machine: where it listens, the token that
 * opens it and which instance it is. Strict, so a reader of this format version rejects a field it
 * does not know. `formatVersion` is the layout of this file, not the protocol version. The maxima
 * and the plain text of `url` and `token` keep any value of this schema within
 * `DISCOVERY_MAX_BYTES`, so a file this schema accepts is never refused by size.
 */
export const discoveryFileSchema = z.strictObject({
  formatVersion: z.literal(DISCOVERY_FORMAT_VERSION),
  // The pattern runs on the raw string, before `z.url()` can clean it: the URL parser drops tabs
  // and newlines and trims spaces, so a check after it would never see them.
  url: z
    .string()
    .max(DISCOVERY_URL_MAX_CHARS)
    .regex(DISCOVERY_PLAIN_TEXT_PATTERN)
    .pipe(z.url().refine(isPlainHttpUrl)),
  token: z
    .string()
    .min(DISCOVERY_TOKEN_MIN_CHARS)
    .max(DISCOVERY_TOKEN_MAX_CHARS)
    .regex(DISCOVERY_PLAIN_TEXT_PATTERN),
  instanceId: instanceIdSchema,
  pid: z.number().int().positive(),
  serverVersion: serverVersionSchema.max(DISCOVERY_VERSION_MAX_CHARS),
  protocolVersion: protocolVersionSchema.max(DISCOVERY_VERSION_MAX_CHARS),
});

const formatVersionOnlySchema = z.object({ formatVersion: z.number().int().positive() });

/**
 * Reads only the format version of an unknown value, so a file of a newer format is told apart
 * from a broken one before the strict schema, which would reject it for its new fields. A number
 * below the current format is a format this code never knew, so it reads as `unreadable`.
 */
export function peekFormatVersion(input: unknown): DiscoveryFormatPeek {
  const parsed = formatVersionOnlySchema.safeParse(input);

  if (!parsed.success) {
    return { status: 'unreadable' };
  }

  const { formatVersion } = parsed.data;

  if (formatVersion === DISCOVERY_FORMAT_VERSION) {
    return { status: 'current' };
  }

  if (formatVersion > DISCOVERY_FORMAT_VERSION) {
    return { status: 'newer', formatVersion };
  }

  return { status: 'unreadable' };
}
