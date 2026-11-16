/**
 * The metadata keys an adapter's config schema carries so the registry can tell a form from a
 * secret from what the host supplies. A field with neither is something a person chooses, and a
 * model's file holds it.
 */
export const FIELD_KIND = { secret: 'secret', host: 'host' } as const;

/** Milliseconds in a second: `retry-after` is sent in seconds. */
export const MS_PER_SECOND = 1000;

/**
 * The longest `retry-after` worth waiting for. A server asking for more (a day, say) gets its
 * error reported instead, rather than a run that hangs with nothing to show for it.
 */
export const MAX_RETRY_AFTER_MS = 60_000;

/** Query parameter names that carry a credential, so an endpoint URL is stored without them. */
export const SECRET_QUERY_NAME = /key|token|secret|sig|auth|password|credential/i;

/** What a credential query value is replaced with in a stored endpoint. */
export const REDACTED_QUERY_VALUE = 'REDACTED';

/** Where a server-sent events line ends: `\r\n`, `\r` or `\n`. */
export const LINE_BREAK = /\r\n|\r|\n/;
