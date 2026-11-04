import { afterEach, beforeEach } from 'vitest';
import { Settings } from 'luxon';

/** Any fixed moment will do; this one is 2023-11-14, far from a boundary a test might trip on. */
const DEFAULT_START = 1_700_000_000_000;

/**
 * Test-only: freezes the clock for each test of the calling file at `start` (milliseconds since
 * the epoch), so what a test stamps is exact. `advance(ms)` moves it. Everything that reads time
 * through `now()` from `@sheavly/core/clock/clock.helper` sees it.
 */
export function useFixedClock(start = DEFAULT_START) {
  const clock = {
    at: start,
    // An arrow, so it can be handed on as a plain function (`advance: clock.advance`).
    advance: (ms: number) => {
      clock.at += ms;
    },
  };
  const luxonsOwnClock = Settings.now;

  beforeEach(() => {
    clock.at = start;
    Settings.now = () => clock.at;
  });
  afterEach(() => {
    Settings.now = luxonsOwnClock;
  });

  return clock;
}
