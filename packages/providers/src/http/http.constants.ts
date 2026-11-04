/**
 * The metadata keys an adapter's config schema carries so the registry can tell a form from a
 * secret from what the host supplies. A field with neither is something a person chooses, and a
 * model's file holds it.
 */
export const FIELD_KIND = { secret: 'secret', host: 'host' } as const;
