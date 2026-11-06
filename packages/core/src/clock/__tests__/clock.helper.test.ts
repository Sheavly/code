import { afterEach, describe, expect, it } from 'vitest';
import { DateTime, Settings } from 'luxon';
import { timestampSchema } from '@sheavly/protocol/time/time.validator';
import { now } from '../clock.helper.js';

describe('now', () => {
  const luxonsOwnClock = Settings.now;

  afterEach(() => {
    Settings.now = luxonsOwnClock;
  });

  it('is the time Luxon reads, so a test can fix it', () => {
    Settings.now = () => 1_700_000_000_123;

    expect(now()).toBe(1_700_000_000_123);
  });

  it('is a timestamp the protocol accepts: whole milliseconds, near the real time', () => {
    const before = DateTime.now().toMillis();
    const stamped = now();

    expect(timestampSchema.safeParse(stamped).success).toBe(true);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped - before).toBeLessThan(1000);
  });
});
