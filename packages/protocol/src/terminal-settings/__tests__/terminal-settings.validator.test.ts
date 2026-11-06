import { describe, expect, it } from 'vitest';
import { terminalSettingsSchema } from '../terminal-settings.validator.js';

describe('terminalSettingsSchema', () => {
  it('accepts both choices and defaults to animated when omitted', () => {
    expect(terminalSettingsSchema.parse({})).toEqual({});

    for (const reducedMotion of [true, false]) {
      expect(terminalSettingsSchema.parse({ reducedMotion })).toEqual({ reducedMotion });
    }
  });

  it.each([true, false])('accepts explicit bell preference %j', (bell) => {
    expect(terminalSettingsSchema.parse({ reducedMotion: true, bell })).toEqual({
      reducedMotion: true,
      bell,
    });
  });

  it.each(['true', 1, null])('rejects non-boolean bell settings: %j', (bell) => {
    expect(terminalSettingsSchema.safeParse({ bell }).success).toBe(false);
  });

  it.each(['true', 1, null])('rejects non-boolean motion settings: %j', (reducedMotion) => {
    expect(terminalSettingsSchema.safeParse({ reducedMotion }).success).toBe(false);
  });
});
