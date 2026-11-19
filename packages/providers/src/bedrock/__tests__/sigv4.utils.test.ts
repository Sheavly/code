import { describe, expect, it } from 'vitest';
import { awsAccessKeyIdSchema } from '../sigv4.validator.js';
import { signAwsRequest } from '../sigv4.utils.js';

// The credentials and time of AWS's published examples, which are public documentation values.
const credentials = {
  accessKeyId: awsAccessKeyIdSchema.parse('AKIDEXAMPLE'),
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};
const AT = 1_440_938_160_000; // 2015-08-30T12:36:00Z

describe('signAwsRequest', () => {
  it('signs the "get-vanilla" request of AWS’s SigV4 test suite as AWS does', () => {
    const signed = signAwsRequest({
      method: 'GET',
      url: new URL('https://example.amazonaws.com/'),
      headers: {},
      body: '',
      region: 'us-east-1',
      service: 'service',
      credentials,
      at: AT,
    });

    expect(signed).toEqual({
      'x-amz-date': '20150830T123600Z',
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    });
  });

  it('signs the ListUsers example of AWS’s signing guide as AWS does: a query, a header and a service', () => {
    const signed = signAwsRequest({
      method: 'GET',
      url: new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: '',
      region: 'us-east-1',
      service: 'iam',
      credentials,
      at: AT,
    });

    expect(signed.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });

  const post = (overrides: object = {}) =>
    signAwsRequest({
      method: 'POST',
      url: new URL('https://bedrock-runtime.us-east-1.amazonaws.com/anthropic/v1/messages'),
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: '{"a":1}',
      region: 'us-east-1',
      service: 'bedrock',
      credentials,
      at: AT,
      ...overrides,
    });

  it('signs every header it is given, so none can be changed on the way', () => {
    expect(post().authorization).toContain(
      'SignedHeaders=anthropic-version;content-type;host;x-amz-date,',
    );
  });

  it('changes the signature with the body, the time and the Region, and nothing else moves', () => {
    const signature = (signed: Record<string, string>) => signed.authorization;

    expect(signature(post({ body: '{"a":2}' }))).not.toBe(signature(post()));
    expect(signature(post({ at: AT + 1000 }))).not.toBe(signature(post()));
    expect(signature(post({ region: 'eu-west-1' }))).not.toBe(signature(post()));
    expect(signature(post())).toBe(signature(post()));
  });

  it('sends a session token with the signature and signs it, for temporary credentials', () => {
    const signed = post({ credentials: { ...credentials, sessionToken: 'session-token' } });

    expect(signed['x-amz-security-token']).toBe('session-token');
    expect(signed.authorization).toContain('x-amz-security-token');
  });

  it('adds no session token for a long-term key pair', () => {
    expect(post()).not.toHaveProperty('x-amz-security-token');
  });

  it('never puts the secret key in what it returns', () => {
    expect(JSON.stringify(post())).not.toContain(credentials.secretAccessKey);
  });

  it.each([
    ['a name with a colon', { 'x-a:b': 'v' }],
    ['a name with a line break', { 'x-a\nb': 'v' }],
    ['a value with a line break', { 'x-a': 'one\r\nx-b: two' }],
    ['a value with a control character', { 'x-a': 'v\u0000' }],
    ['the same name twice, in other capitals', { 'x-a': '1', 'X-A': '2' }],
    ['a name the signer sets, in other capitals', { Authorization: 'x' }],
    ['a Host of its own', { Host: 'evil.example.com' }],
    ['an x-amz-date of its own', { 'X-Amz-Date': '20000101T000000Z' }],
  ])('refuses to sign %s, and says nothing of what it held', (_name, headers) => {
    const attempt = () => post({ headers });

    expect(attempt).toThrow('A header cannot be signed');
    expect(attempt).toThrow(/^(?!.*(evil|one|two)).*$/s);
  });

  it('signs the same request the same whatever the capitals of a header name', () => {
    expect(post({ headers: { 'Content-Type': 'application/json' } }).authorization).toBe(
      post({ headers: { 'content-type': 'application/json' } }).authorization,
    );
  });

  it('signs a query whatever the order of its parameters, and the port it is sent to', () => {
    const at = (path: string) =>
      post({ url: new URL(`https://bedrock-runtime.us-east-1.amazonaws.com${path}`) })
        .authorization;

    expect(at('/p?b=1&a=2&B=3')).toBe(at('/p?B=3&a=2&b=1'));
    expect(at('/p?a=1')).not.toBe(at('/p?a=2'));
    expect(
      post({ url: new URL('https://bedrock-runtime.us-east-1.amazonaws.com:8443/p') })
        .authorization,
    ).not.toBe(
      post({ url: new URL('https://bedrock-runtime.us-east-1.amazonaws.com/p') }).authorization,
    );
  });

  it('signs a path the way AWS does for a service that is not S3: each segment encoded twice', () => {
    // `a b` is `a%20b` in the URL and `a%2520b` in the canonical path, so a request for it differs
    // from one for the literal `a%20b`, and from one that never had the space.
    const at = (path: string) =>
      post({ url: new URL(`https://bedrock-runtime.us-east-1.amazonaws.com${path}`) })
        .authorization;

    expect(at('/a b')).not.toBe(at('/ab'));
    expect(at('/a b')).toBe(at('/a%20b'));
  });
});
