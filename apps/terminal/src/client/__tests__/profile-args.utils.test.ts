import { describe, expect, it } from 'vitest';
import { profileArgs } from '../profile-args.utils.js';

const WORK = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';

describe('profileArgs', () => {
  it('takes the profile id and leaves the flag and its value out of the prompt words', () => {
    expect(profileArgs(['fix', '--profile', WORK, 'the', 'bug'])).toEqual({
      profile: WORK,
      args: ['fix', 'the', 'bug'],
    });
  });

  it('is none when the flag is absent, leaving the arguments as they are', () => {
    expect(profileArgs(['hello', '--trust'])).toEqual({
      profile: undefined,
      args: ['hello', '--trust'],
    });
  });

  it.each([
    [['--profile']],
    [['--profile', 'work']],
    [['--profile', WORK.toUpperCase()]],
    [['--profile', '--trust']],
  ])('refuses a missing or malformed id instead of falling back: %j', (args) => {
    expect(() => profileArgs(args)).toThrow('--profile requires a profile id');
  });
});
