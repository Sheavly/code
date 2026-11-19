import { createHash, createHmac } from 'node:crypto';
import { RequestSigningError } from '../errors/providers.errors.js';
import {
  HEADER_NAME,
  SIGV4_ALGORITHM,
  SIGV4_OWN_HEADERS,
  SIGV4_TERMINATOR,
} from './sigv4.constants.js';
import type { AwsCredentials } from './sigv4.types.js';

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const hmac = (params: { key: string | Buffer; text: string }) =>
  createHmac('sha256', params.key).update(params.text, 'utf8').digest();

/** RFC 3986 encoding: what `encodeURIComponent` leaves of `! ' ( ) *` is encoded too. */
const encodeRfc3986 = (text: string) =>
  encodeURIComponent(text).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * The time as SigV4 writes it: the date (`20150830`) and the stamp (`20150830T123600Z`), in UTC.
 * `at` is epoch milliseconds, read by the caller from the clock, so nothing here knows the time.
 */
function utcStamp(at: number): { date: string; stamp: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map(({ type, value }) => [type, value]),
  ) as Record<string, string>;
  const date = `${parts.year}${parts.month}${parts.day}`;

  return { date, stamp: `${date}T${parts.hour}${parts.minute}${parts.second}Z` };
}

/** Each path segment encoded a second time, as every service but S3 signs it. */
const canonicalPath = (pathname: string) =>
  pathname
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/') || '/';

/** Orders strings by UTF-16 code unit, as SigV4 sorts, and not by locale. */
function byCodeUnit(params: { a: string; b: string }): number {
  const { a, b } = params;

  if (a < b) return -1;

  return a > b ? 1 : 0;
}

/** The query as `name=value` pairs, both encoded, sorted by name and then value. */
function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)] as const)
    .sort(([a, aValue], [b, bValue]) => byCodeUnit(a === b ? { a: aValue, b: bValue } : { a, b }))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/**
 * Whether `value` has a character a header value may not carry: anything but a visible one, a
 * space or a tab, so a line break, a NUL or DEL. Written as what is allowed, because lint refuses
 * a control character in a pattern.
 */
const hasControlCharacter = (value: string) => !/^[\t \x21-\x7e\u0080-\uffff]*$/.test(value);

/**
 * The caller's headers with lowercase names, each checked: a token for a name, no control character
 * in a value, no name twice and none the signer sets itself. Throws `RequestSigningError` without
 * saying what the header held.
 */
function givenHeaders(headers: Record<string, string>): [string, string][] {
  const given = Object.entries(headers).map(
    ([name, value]) => [name.toLowerCase(), value] as const,
  );
  const names = given.map(([name]) => name);
  const bad = given.some(
    ([name, value], index) =>
      !HEADER_NAME.test(name) ||
      hasControlCharacter(value) ||
      names.indexOf(name) !== index ||
      SIGV4_OWN_HEADERS.some((own) => own === name),
  );

  if (bad) {
    throw new RequestSigningError({
      message:
        'A header cannot be signed: its name is not a token or is repeated or reserved, or its value has a control character',
    });
  }

  return given.map(([name, value]) => [name, value]);
}

/**
 * The headers to add to a request so AWS accepts it as made by `credentials`: `authorization`,
 * `x-amz-date` and, for temporary credentials, `x-amz-security-token`. Every header in `headers`
 * is signed, with `host` from the URL, so none can be changed on the way. `at` is the signing time
 * in epoch milliseconds: a signature is good for about five minutes, so sign each attempt anew.
 * The secret key never leaves this function. Throws `RequestSigningError` for a header that cannot
 * be signed faithfully (see `givenHeaders`), never saying what it held.
 */
export function signAwsRequest(params: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  at: number;
}): Record<string, string> {
  const { method, url, headers, body, region, service, credentials, at } = params;
  const { date, stamp } = utcStamp(at);
  const added: Record<string, string> = {
    'x-amz-date': stamp,
    ...(credentials.sessionToken && { 'x-amz-security-token': credentials.sessionToken }),
  };
  const signed = [...givenHeaders(headers), ['host', url.host], ...Object.entries(added)]
    .map(([name = '', value = '']) => [name, value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => byCodeUnit({ a, b }));
  const names = signed.map(([name]) => name).join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url),
    `${signed.map(([name, value]) => `${name}:${value}`).join('\n')}\n`,
    names,
    sha256Hex(body),
  ].join('\n');
  const scope = [date, region, service, SIGV4_TERMINATOR].join('/');
  const stringToSign = [SIGV4_ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const key = [date, region, service, SIGV4_TERMINATOR].reduce<string | Buffer>(
    (previous, text) => hmac({ key: previous, text }),
    `AWS4${credentials.secretAccessKey}`,
  );
  const signature = hmac({ key, text: stringToSign }).toString('hex');

  return {
    ...added,
    authorization: `${SIGV4_ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
  };
}
