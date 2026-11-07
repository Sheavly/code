import { describe, expect, it, vi } from 'vitest';
import { Agent } from 'undici';
import { toolRunner } from '@sheavly/testing/tool/tool-runner.fake';
import { createWebFetchTool } from '../web-fetch.tool.js';
import { isPublicAddress } from '../address.utils.js';
import { fakeFetch } from '../../testing/web-fetch.fake.js';
import type { WebFetchOptions } from '../web-fetch.types.js';

const run = (options: WebFetchOptions, url = 'https://example.com/') =>
  toolRunner([createWebFetchTool(options)])('address-1', 'web_fetch', { url });
const reply = () => new Response('hello', { headers: { 'content-type': 'text/plain' } });

describe('web_fetch public address policy', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '172.16.1.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    '2002:0a00:0001::',
    '2001::1',
    '2001:db8::1',
    '3fff::1',
    '5f00::1',
    'not an IP',
  ])('refuses non-public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111'])(
    'recognizes public address %s',
    (address) => expect(isPublicAddress(address)).toBe(true),
  );

  it.each([
    'http://localhost',
    'http://LOCALHOST.',
    'http://metadata.localhost',
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://169.254.169.254',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
  ])('blocks URL %s before fetch', async (url) => {
    const fake = fakeFetch([]);
    const result = await run(fake, url);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('non-public');
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a hostname with any private DNS answer, or none', async () => {
    for (const addresses of [
      [],
      [{ address: '10.0.0.1', family: 4 }],
      [
        { address: '8.8.8.8', family: 4 },
        { address: 'fe80::1', family: 6 },
      ],
    ]) {
      const fake = fakeFetch([]);
      const result = await run({ ...fake, resolveAddresses: async () => addresses });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Refused non-public address for example.com');
      expect(fake.requests).toHaveLength(0);
    }
  });

  it('checks redirects to metadata and credentials without fetching the target', async () => {
    for (const location of [
      'http://169.254.169.254/latest/meta-data',
      'https://user:password@example.com',
      'file:///etc/passwd',
    ]) {
      const fake = fakeFetch([new Response(null, { status: 302, headers: { location } })]);
      const result = await run(fake);

      expect(result.isError).toBe(true);
      expect(fake.requests).toHaveLength(1);
    }
  });

  it('rechecks DNS even on a redirect to the same hostname', async () => {
    const fake = fakeFetch([
      new Response(null, { status: 307, headers: { location: '/private' } }),
    ]);
    const resolveAddresses = vi
      .fn()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '192.168.0.1', family: 4 }]);
    const result = await run({ ...fake, resolveAddresses });

    expect(result.content).toContain('non-public address');
    expect(resolveAddresses).toHaveBeenCalledTimes(2);
    expect(fake.requests).toHaveLength(1);
  });

  it('honours domain allow/deny lists, normalizes names and rejects sibling lookalikes', async () => {
    const allowed = await run(
      { ...fakeFetch([reply()]), allowedDomains: ['EXAMPLE.COM.'] },
      'https://docs.example.com/',
    );

    expect(allowed.isError).toBe(false);

    for (const options of [
      { allowedDomains: [] },
      { allowedDomains: ['other.com'] },
      { allowedDomains: ['example.com'], deniedDomains: ['example.com'] },
      { deniedDomains: ['docs.example.com'] },
    ]) {
      const fake = fakeFetch([]);
      const result = await run({ ...fake, ...options }, 'https://docs.example.com/');

      expect(result.isError).toBe(true);
      expect(fake.requests).toHaveLength(0);
    }

    const lookalike = await run(
      { ...fakeFetch([]), allowedDomains: ['example.com'] },
      'https://notexample.com/',
    );

    expect(lookalike.content).toContain('not in the allow list');
    expect(() => createWebFetchTool({ allowedDomains: ['https://example.com'] })).toThrow();
  });

  it('applies domain policies to redirects without letting allow lists permit private IPs', async () => {
    const fake = fakeFetch([
      new Response(null, { status: 302, headers: { location: 'https://other.com/' } }),
    ]);
    const blocked = await run({ ...fake, allowedDomains: ['example.com'] });
    const privateAllowed = await run(
      { ...fakeFetch([]), allowedDomains: ['127.0.0.1'] },
      'http://127.0.0.1/',
    );

    expect(blocked.content).toContain('not in the allow list');
    expect(fake.requests).toHaveLength(1);
    expect(privateAllowed.content).toContain('non-public address');
  });

  it('uses a direct pinned dispatcher, manual redirects and no credentials on every request', async () => {
    const fake = fakeFetch([
      new Response(null, {
        status: 303,
        headers: { location: 'https://other.com/', 'set-cookie': 'session=secret' },
      }),
      reply(),
    ]);
    const result = await run(fake);

    expect(result.isError).toBe(false);

    for (const { init } of fake.requests) {
      expect(init.redirect).toBe('manual');
      expect(init.credentials).toBe('omit');
      expect(init.dispatcher).toBeInstanceOf(Agent);
      expect(init.headers).toEqual({
        'user-agent': 'Sheavly-WebFetch/1.0',
        accept:
          'text/html, text/plain, text/markdown, application/json, application/xml, text/xml, application/rss+xml, application/atom+xml',
      });
    }
  });
});
