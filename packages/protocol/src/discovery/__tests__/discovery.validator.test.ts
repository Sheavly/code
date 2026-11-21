import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_FILE_NAME,
  DISCOVERY_MAX_BYTES,
  DISCOVERY_TOKEN_MAX_CHARS,
  DISCOVERY_URL_MAX_CHARS,
  DISCOVERY_VERSION_MAX_CHARS,
} from '../discovery.constants.js';
import type { DiscoveryFile } from '../discovery.types.js';
import { discoveryFileSchema, peekFormatVersion } from '../discovery.validator.js';

const TOKEN = 'k3Y9-realistic_token_AbCdEfGhIjKlMnOpQrStUvWxYz012345';

const VALID = {
  formatVersion: 1,
  url: 'http://127.0.0.1:4317',
  token: TOKEN,
  instanceId: 'a-_'.repeat(14).concat('Z'),
  pid: 4242,
  serverVersion: '1.2.3',
  protocolVersion: '0.9.0',
};

describe('discoveryFileSchema', () => {
  it('accepts a complete file', () => {
    expect(discoveryFileSchema.safeParse(VALID).success).toBe(true);
  });

  it('parses to a DiscoveryFile that keeps every field', () => {
    const file: DiscoveryFile = discoveryFileSchema.parse(VALID);

    expect(file).toEqual(VALID);
  });

  it('is named server.json and a complete file is far below the size a reader takes', () => {
    expect(DISCOVERY_FILE_NAME).toBe('server.json');
    expect(Buffer.byteLength(JSON.stringify(VALID))).toBeLessThan(DISCOVERY_MAX_BYTES / 4);
  });

  it.each(Object.keys(VALID))('rejects a file without %s', (field) => {
    const { [field]: _left, ...rest } = VALID as Record<string, unknown>;

    expect(discoveryFileSchema.safeParse(rest).success).toBe(false);
  });

  it.each([
    ['formatVersion', 2],
    ['formatVersion', '1'],
    ['url', 42],
    ['token', 42],
    ['instanceId', 42],
    ['pid', '4242'],
    ['serverVersion', 1],
    ['protocolVersion', 1],
  ])('rejects a wrong %s', (field, value) => {
    expect(discoveryFileSchema.safeParse({ ...VALID, [field]: value }).success).toBe(false);
  });

  it('rejects a field it does not know', () => {
    expect(discoveryFileSchema.safeParse({ ...VALID, extra: true }).success).toBe(false);
  });

  it('rejects a token of fewer than 32 characters and accepts exactly 32', () => {
    expect(discoveryFileSchema.safeParse({ ...VALID, token: 'a'.repeat(31) }).success).toBe(false);
    expect(discoveryFileSchema.safeParse({ ...VALID, token: 'a'.repeat(32) }).success).toBe(true);
  });

  it('rejects a url that is not a URL', () => {
    expect(discoveryFileSchema.safeParse({ ...VALID, url: 'not a url' }).success).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ftp://127.0.0.1/x',
    'data:text/plain,hi',
    'a:b',
    'http://user:pass@127.0.0.1:4317',
    'http://user@127.0.0.1:4317',
  ])('rejects the url %j, which a token must never be sent to', (url) => {
    expect(discoveryFileSchema.safeParse({ ...VALID, url }).success).toBe(false);
  });

  it.each(['http://127.0.0.1:4317', 'https://example.test:8443/base', 'http://[::1]:4317'])(
    'accepts the url %j',
    (url) => {
      expect(discoveryFileSchema.safeParse({ ...VALID, url }).success).toBe(true);
    },
  );

  it.each(['http://a\tb/', 'http://a\nb/', 'http://a b/', ' http://a/', 'http://a/ '])(
    'rejects the url %j, whose raw text has a character the URL parser would drop or keep',
    (url) => {
      expect(discoveryFileSchema.safeParse({ ...VALID, url }).success).toBe(false);
    },
  );

  it.each(['http://127.0.0.1:4310', 'http://[::1]:1/', 'https://a', 'HTTP://X'])(
    'still accepts the url %j',
    (url) => {
      expect(discoveryFileSchema.safeParse({ ...VALID, url }).success).toBe(true);
    },
  );

  it('rejects a token or url over its maximum and accepts exactly the maximum', () => {
    const url = `http://127.0.0.1/${'a'.repeat(DISCOVERY_URL_MAX_CHARS - 'http://127.0.0.1/'.length)}`;
    const token = 'a'.repeat(DISCOVERY_TOKEN_MAX_CHARS);

    expect(discoveryFileSchema.safeParse({ ...VALID, url, token }).success).toBe(true);
    expect(discoveryFileSchema.safeParse({ ...VALID, url: `${url}a` }).success).toBe(false);
    expect(discoveryFileSchema.safeParse({ ...VALID, token: `${token}a` }).success).toBe(false);
  });

  it('rejects a token or url with a character that grows when written as JSON', () => {
    expect(discoveryFileSchema.safeParse({ ...VALID, token: `${TOKEN}"` }).success).toBe(false);
    expect(discoveryFileSchema.safeParse({ ...VALID, token: `${TOKEN}\\` }).success).toBe(false);
    expect(discoveryFileSchema.safeParse({ ...VALID, token: `${TOKEN}\n` }).success).toBe(false);
    expect(discoveryFileSchema.safeParse({ ...VALID, token: `${TOKEN}é` }).success).toBe(false);
    expect(discoveryFileSchema.safeParse({ ...VALID, url: 'http://127.0.0.1/"x' }).success).toBe(
      false,
    );
  });

  it('keeps a file with every field at its maximum within the size a reader takes', () => {
    const version = '9.9.9-'.padEnd(DISCOVERY_VERSION_MAX_CHARS, 'z');
    const parsed = discoveryFileSchema.parse({
      ...VALID,
      url: 'https://example.test/'.padEnd(DISCOVERY_URL_MAX_CHARS, '~'),
      token: ''.padEnd(DISCOVERY_TOKEN_MAX_CHARS, '~'),
      pid: Number.MAX_SAFE_INTEGER,
      serverVersion: version,
      protocolVersion: version,
    });

    expect(Buffer.byteLength(`${JSON.stringify(parsed)}\n`)).toBeLessThan(DISCOVERY_MAX_BYTES);
  });

  it('rejects a version over its maximum', () => {
    const long = `1.2.3-${'a'.repeat(DISCOVERY_VERSION_MAX_CHARS)}`;

    expect(discoveryFileSchema.safeParse({ ...VALID, serverVersion: long }).success).toBe(false);
    expect(discoveryFileSchema.safeParse({ ...VALID, protocolVersion: long }).success).toBe(false);
  });

  it.each(['a'.repeat(42), 'a'.repeat(44), ''])(
    'rejects an instance id %j of the wrong length',
    (id) => {
      expect(discoveryFileSchema.safeParse({ ...VALID, instanceId: id }).success).toBe(false);
    },
  );

  it.each([0, -1, 1.5])('rejects pid %s', (pid) => {
    expect(discoveryFileSchema.safeParse({ ...VALID, pid }).success).toBe(false);
  });

  it('never repeats the token in an error message', () => {
    const results = [
      discoveryFileSchema.safeParse({ ...VALID, url: 'not a url', extra: TOKEN }),
      discoveryFileSchema.safeParse({ ...VALID, pid: 0, formatVersion: 2 }),
      discoveryFileSchema.safeParse({ ...VALID, instanceId: 'short' }),
    ];

    for (const result of results) {
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).not.toContain(TOKEN);
      expect(result.error?.message).not.toContain(TOKEN);
    }
  });

  it('does not repeat a token that is too short either', () => {
    const short = 'sh0rt-secret-token';
    const result = discoveryFileSchema.safeParse({ ...VALID, token: short });

    expect(result.success).toBe(false);
    expect(result.error?.message).not.toContain(short);
  });
});

describe('peekFormatVersion', () => {
  it('finds the current format', () => {
    expect(peekFormatVersion(VALID)).toEqual({ status: 'current' });
  });

  it('finds a newer format even when its other fields are unknown', () => {
    expect(peekFormatVersion({ formatVersion: 2, somethingNew: true })).toEqual({
      status: 'newer',
      formatVersion: 2,
    });
  });

  it.each([
    ['missing', {}],
    ['a string', { formatVersion: '2' }],
    ['null', { formatVersion: null }],
    ['fractional', { formatVersion: 1.5 }],
    ['zero', { formatVersion: 0 }],
    ['negative', { formatVersion: -1 }],
    ['not an object', 'text'],
    ['null input', null],
  ])('finds a format version that is %s unreadable', (_name, input) => {
    expect(peekFormatVersion(input)).toEqual({ status: 'unreadable' });
  });
});
