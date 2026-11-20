import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseSemver } from '../semver.utils.js';
import { SEMVER_DESCRIPTION, SEMVER_PATTERN } from '../version.constants.js';
import { protocolVersionSchema, serverVersionSchema } from '../version.validator.js';

describe('parseSemver', () => {
  it('reads major, minor and patch as numbers', () => {
    expect(parseSemver('10.20.30')).toEqual({
      ok: true,
      version: { major: 10, minor: 20, patch: 30, prerelease: [] },
    });
  });

  it('reads prerelease identifiers, numeric ones as numbers', () => {
    expect(parseSemver('1.0.0-rc.1.x-y.0')).toEqual({
      ok: true,
      version: { major: 1, minor: 0, patch: 0, prerelease: ['rc', 1, 'x-y', 0] },
    });
  });

  it.each(['', '1', '1.2', '1.2.3.4', 'v1.2.3', '1.2.x', ' 1.2.3', '1.2.3 ', '-1.2.3', '1.2.-3'])(
    'rejects %j as malformed',
    (text) => {
      expect(parseSemver(text)).toEqual({ ok: false, reason: 'malformed' });
    },
  );

  it.each(['1.0.0-', '1.0.0-.', '1.0.0-a..b', '1.0.0-a.', '1.0.0-é'])(
    'rejects the prerelease of %j as malformed',
    (text) => {
      expect(parseSemver(text)).toEqual({ ok: false, reason: 'malformed' });
    },
  );

  it('rejects a number too large to compare exactly', () => {
    expect(parseSemver('99999999999999999999.0.0')).toEqual({ ok: false, reason: 'malformed' });
  });

  it.each(['1.0.0-9007199254740992', '1.0.0-a.9007199254740993', `1.0.0-${'9'.repeat(400)}`])(
    'rejects %j: a numeric prerelease identifier past 2^53-1 would lose precision',
    (text) => {
      expect(parseSemver(text)).toEqual({ ok: false, reason: 'malformed' });
    },
  );

  it('keeps the largest exact numeric prerelease identifier', () => {
    expect(parseSemver('1.0.0-9007199254740991')).toEqual({
      ok: true,
      version: { major: 1, minor: 0, patch: 0, prerelease: [Number.MAX_SAFE_INTEGER] },
    });
  });

  it.each(['01.2.3', '1.02.3', '1.2.03', '1.0.0-01', '1.0.0-alpha.007'])(
    'rejects a leading zero in %j',
    (text) => {
      expect(parseSemver(text)).toEqual({ ok: false, reason: 'leading-zero' });
    },
  );

  it('accepts a zero and a prerelease identifier that only starts with one', () => {
    expect(parseSemver('0.0.0-0a.0').ok).toBe(true);
  });

  it.each(['1.2.3+build', '1.2.3-rc.1+sha.5114f85', '1.2.3+'])(
    'rejects build metadata in %j',
    (text) => {
      expect(parseSemver(text)).toEqual({ ok: false, reason: 'build-metadata' });
    },
  );
});

describe('protocolVersionSchema', () => {
  it('accepts what parseSemver accepts and nothing else', () => {
    expect(protocolVersionSchema.safeParse('0.3.1-beta.2').success).toBe(true);
    expect(protocolVersionSchema.safeParse('1.2.3+build').success).toBe(false);
    expect(protocolVersionSchema.safeParse('01.2.3').success).toBe(false);
    expect(protocolVersionSchema.safeParse(1).success).toBe(false);
  });

  it.each([
    ['protocol', protocolVersionSchema],
    ['server', serverVersionSchema],
  ])('carries the grammar into the generated JSON schema of a %s version', (_name, schema) => {
    const generated = z.toJSONSchema(schema) as { pattern?: string; description?: string };

    expect(generated.pattern).toBe(SEMVER_PATTERN.source);
    expect(generated.description).toBe(SEMVER_DESCRIPTION);
  });
});
