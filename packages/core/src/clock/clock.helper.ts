import { DateTime } from 'luxon';

/**
 * The current time as a `timestampSchema` value: whole milliseconds since the epoch. The only
 * place a package reads the clock (lint fails `Date.now()` and `new Date()`), and it reads it
 * through Luxon, so a test fixes it with `useFixedClock` instead of racing real time.
 */
export function now(): number {
  return DateTime.now().toMillis();
}

/** An HTTP date (`Wed, 21 Oct 2026 07:28:00 GMT`) as epoch milliseconds, or undefined if it is not one. */
export function httpDateMs(value: string): number | undefined {
  const date = DateTime.fromHTTP(value);

  return date.isValid ? date.toMillis() : undefined;
}
