import { describe, expect, it } from 'vitest';
import type { Semver } from '../semver.types.js';
import { compareSemver, isCompatible, parseSemver } from '../semver.utils.js';

function semver(text: string): Semver {
  const result = parseSemver(text);

  if (!result.ok) throw new TypeError(`${text} is not a version in this test`);

  return result.version;
}

function compare(a: string, b: string): number {
  return compareSemver({ a: semver(a), b: semver(b) });
}

function compatible(a: string, b: string): boolean {
  return isCompatible({ a: semver(a), b: semver(b) });
}

describe('compareSemver', () => {
  it('follows the precedence chain of semver.org', () => {
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];

    for (const [index, lower] of chain.entries()) {
      for (const higher of chain.slice(index + 1)) {
        expect(compare(lower, higher)).toBe(-1);
        expect(compare(higher, lower)).toBe(1);
      }

      expect(compare(lower, lower)).toBe(0);
    }
  });

  it('orders the core by value, not as text', () => {
    expect(compare('1.2.0', '1.10.0')).toBe(-1);
    expect(compare('2.0.0', '10.0.0')).toBe(-1);
    expect(compare('1.0.9', '1.0.10')).toBe(-1);
    expect(compare('1.9.0', '2.0.0-rc.1')).toBe(-1);
  });

  it('puts a prerelease below its release and above the release before it', () => {
    expect(compare('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compare('0.9.9', '1.0.0-alpha')).toBe(-1);
  });

  it('puts numeric identifiers below text ones and compares text in ASCII order', () => {
    expect(compare('1.0.0-1', '1.0.0-a')).toBe(-1);
    expect(compare('1.0.0-B', '1.0.0-a')).toBe(-1);
  });
});

describe('isCompatible', () => {
  it.each([
    ['0.3.1', '0.3.9', true],
    ['0.3.1', '0.4.0', false],
    ['0.3.1', '0.2.9', false],
    ['1.2.0', '1.9.9', true],
    ['1.9.9', '1.2.0', true],
    ['1.2.0', '2.0.0', false],
    ['2.0.0', '1.99.99', false],
    ['0.0.0', '0.0.1', true],
    ['0.9.0', '1.0.0', false],
    ['0.3.1', '0.3.1-rc.1', true],
    ['1.2.0-beta.1', '1.7.0', true],
    ['1.0.0-rc.1', '2.0.0-rc.1', false],
  ])('%s with %s: %s', (a, b, expected) => {
    expect(compatible(a, b)).toBe(expected);
  });
});
