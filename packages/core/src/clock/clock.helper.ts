import { DateTime } from 'luxon';

/**
 * The current time as a `timestampSchema` value: whole milliseconds since the epoch. The only
 * place a package reads the clock (lint fails `Date.now()` and `new Date()`), and it reads it
 * through Luxon, so a test fixes it with `useFixedClock` instead of racing real time.
 */
export function now(): number {
  return DateTime.now().toMillis();
}
