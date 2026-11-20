import { describe, expect, it } from 'vitest';
import { ProtocolVersionError } from '../version.errors.js';
import { checkProtocolVersion } from '../version.utils.js';

describe('checkProtocolVersion', () => {
  it.each([
    ['1.2.3', '1.2.3'],
    ['0.3.1', '0.3.9'],
    ['1.2.0', '1.9.9'],
    ['1.2.0-rc.1', '1.4.0'],
  ])('matches %s with %s', (client, server) => {
    expect(checkProtocolVersion({ client, server })).toEqual({ match: true });
  });

  it('says the server is older, names both versions and gives one action', () => {
    expect(checkProtocolVersion({ client: '1.4.0', server: '0.9.0' })).toEqual({
      match: false,
      older: 'server',
      client: '1.4.0',
      server: '0.9.0',
      message:
        'The server speaks protocol 0.9.0 and this client 1.4.0: the server is older. Update and restart the server, then try again.',
    });
  });

  it('says this client is older, names both versions and gives one action', () => {
    expect(checkProtocolVersion({ client: '0.3.1', server: '0.4.0' })).toEqual({
      match: false,
      older: 'client',
      client: '0.3.1',
      server: '0.4.0',
      message:
        'The server speaks protocol 0.4.0 and this client 0.3.1: this client is older. Update this client.',
    });
  });

  it('never blames the other side', () => {
    const olderServer = checkProtocolVersion({ client: '2.0.0', server: '1.0.0' });
    const olderClient = checkProtocolVersion({ client: '1.0.0', server: '2.0.0' });

    expect(olderServer).toMatchObject({ older: 'server' });
    expect(olderClient).toMatchObject({ older: 'client' });
    expect(JSON.stringify(olderServer)).not.toContain('this client is older');
    expect(JSON.stringify(olderClient)).not.toContain('the server is older');
  });

  it('compares across a prerelease by precedence', () => {
    expect(checkProtocolVersion({ client: '2.0.0-rc.1', server: '1.9.0' })).toMatchObject({
      match: false,
      older: 'server',
    });
  });

  it('throws a typed error for a version that is not one, naming it and why', () => {
    const attempt = () => checkProtocolVersion({ client: '1.0.0', server: 'latest' });

    expect(attempt).toThrow(ProtocolVersionError);
    expect(attempt).toThrow(/"latest"/);
    expect(() => checkProtocolVersion({ client: '1.0.0+b', server: '1.0.0' })).toThrow(
      expect.objectContaining({ version: '1.0.0+b', reason: 'build-metadata' }),
    );
  });

  it('throws when both versions are malformed', () => {
    expect(() => checkProtocolVersion({ client: 'x', server: 'y' })).toThrow(ProtocolVersionError);
  });
});
