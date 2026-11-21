import { describe, expect, it } from 'vitest';
import {
  discoveryTempName,
  discoveryTempPid,
  parseDiscoveryText,
  refuseOpenFile,
} from '../discovery-file.utils.js';
import { sampleDiscoveryFile } from '../testing/discovery-file.fake.js';

const regular = { isFile: true, uid: 1000, mode: 0o100600, size: 200 };

describe('the temp name', () => {
  it('holds the pid, which the sweep reads back, and only a temp name has one', () => {
    const name = discoveryTempName({ pid: 4242, nonce: 'abc-123' });

    expect(name).toBe('server.json.4242.abc-123.tmp');
    expect(discoveryTempPid(name)).toBe(4242);
    expect(discoveryTempPid('server.json')).toBeUndefined();
    expect(discoveryTempPid('server.json.x.abc.tmp')).toBeUndefined();
    expect(discoveryTempPid('other.1.abc.tmp')).toBeUndefined();
  });
});

describe('refuseOpenFile', () => {
  const judge = (stat: Partial<typeof regular>, platform: NodeJS.Platform = 'linux') =>
    refuseOpenFile({ stat: { ...regular, ...stat }, uid: 1000, platform });

  it('accepts a regular file of ours that nobody else can open', () => {
    expect(judge({})).toBeUndefined();
    expect(judge({ size: 4096 })).toBeUndefined();
  });

  it.each([
    ['not-regular', { isFile: false }],
    ['too-large', { size: 4097 }],
    ['other-owner', { uid: 1001 }],
    ['too-open', { mode: 0o100640 }],
    ['too-open', { mode: 0o100604 }],
  ])('refuses as %s', (reason, stat) => {
    expect(judge(stat)).toEqual({ reason });
  });

  it('on Windows judges only the kind and the size', () => {
    expect(judge({ uid: 1001, mode: 0o100666 }, 'win32')).toBeUndefined();
    expect(judge({ isFile: false }, 'win32')).toEqual({ reason: 'not-regular' });
    expect(judge({ size: 5000 }, 'win32')).toEqual({ reason: 'too-large' });
  });
});

describe('parseDiscoveryText', () => {
  it('returns a valid file, a newer format and nothing else of what it was given', () => {
    const value = sampleDiscoveryFile();

    expect(parseDiscoveryText(JSON.stringify(value))).toEqual({ status: 'found', value });
    expect(parseDiscoveryText('{"formatVersion":3}')).toEqual({
      status: 'newer',
      formatVersion: 3,
    });
    expect(parseDiscoveryText(`{"token":"${value.token}"`)).toEqual({ status: 'invalid' });
    expect(parseDiscoveryText(JSON.stringify({ ...value, extra: 1 }))).toEqual({
      status: 'invalid',
    });
  });
});
