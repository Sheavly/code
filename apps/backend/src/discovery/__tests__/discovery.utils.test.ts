import { describe, expect, it } from 'vitest';
import { discoveryFileSchema } from '@sheavly/protocol/discovery/discovery.validator';
import { PROTOCOL_VERSION } from '@sheavly/protocol/version/protocol-version.constants';
import { newInstanceId } from '../../instance/instance-id.helper.js';
import { discoveryFileFor, isDiscoverable, publishedUrl } from '../discovery.utils.js';

const FILE = {
  token: 'a'.repeat(43),
  instanceId: newInstanceId(),
  serverVersion: '1.2.3',
  protocolVersion: PROTOCOL_VERSION,
  pid: 4242,
};

describe('isDiscoverable', () => {
  it('is on only when discovery is on and the server does not exit with its parent', () => {
    expect(isDiscoverable({ discovery: true, exitWithParent: false })).toBe(true);
    expect(isDiscoverable({ discovery: true, exitWithParent: true })).toBe(false);
    expect(isDiscoverable({ discovery: false, exitWithParent: false })).toBe(false);
    expect(isDiscoverable({ discovery: false, exitWithParent: true })).toBe(false);
  });
});

describe('publishedUrl', () => {
  it('turns a wildcard host into loopback, so a client can connect to it', () => {
    expect(publishedUrl({ host: '0.0.0.0', port: 4310 })).toBe('http://127.0.0.1:4310');
    expect(publishedUrl({ host: '::', port: 4310 })).toBe('http://127.0.0.1:4310');
    expect(publishedUrl({ host: '[::]', port: 4310 })).toBe('http://127.0.0.1:4310');
  });

  it.each([
    '0',
    '000.0.0.0',
    '::0',
    '0:0:0:0:0:0:0:0',
    '::ffff:0.0.0.0',
    '[::ffff:0.0.0.0]',
    '[::0]',
  ])('turns the wildcard spelling %s into loopback, and the schema accepts it', (host) => {
    const file = discoveryFileFor({ ...FILE, host, port: 4310 });

    expect(file.url).toBe('http://127.0.0.1:4310');
    expect(discoveryFileSchema.parse(file)).toEqual(file);
  });

  it('publishes a host the URL parser rejects as given, and never throws', () => {
    expect(publishedUrl({ host: 'a b', port: 5 })).toBe('http://a b:5');
    expect(publishedUrl({ host: '', port: 5 })).toBe('http://:5');
  });

  it('keeps a valid address that is not a wildcard exactly as given', () => {
    expect(publishedUrl({ host: '1.2.3', port: 5 })).toBe('http://1.2.3:5');
    expect(publishedUrl({ host: '::ffff:7f00:1', port: 5 })).toBe('http://[::ffff:7f00:1]:5');
  });

  it('brackets an IPv6 literal, bracketed or not', () => {
    expect(publishedUrl({ host: '::1', port: 22000 })).toBe('http://[::1]:22000');
    expect(publishedUrl({ host: '[::1]', port: 22000 })).toBe('http://[::1]:22000');
  });

  it('uses any other host as given', () => {
    expect(publishedUrl({ host: '127.0.0.1', port: 5 })).toBe('http://127.0.0.1:5');
    expect(publishedUrl({ host: 'localhost', port: 5 })).toBe('http://localhost:5');
    expect(publishedUrl({ host: '192.168.1.20', port: 5 })).toBe('http://192.168.1.20:5');
  });
});

describe('discoveryFileFor', () => {
  it('builds a file the protocol schema accepts, with the real address and versions', () => {
    const file = discoveryFileFor({
      host: '0.0.0.0',
      port: 24680,
      token: 'a'.repeat(43),
      instanceId: newInstanceId(),
      serverVersion: '1.2.3',
      protocolVersion: PROTOCOL_VERSION,
      pid: 4242,
    });

    expect(discoveryFileSchema.parse(file)).toEqual(file);
    expect(file).toMatchObject({
      url: 'http://127.0.0.1:24680',
      pid: 4242,
      serverVersion: '1.2.3',
      protocolVersion: PROTOCOL_VERSION,
    });
  });
});
