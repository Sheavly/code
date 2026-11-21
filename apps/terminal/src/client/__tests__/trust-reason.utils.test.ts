import { describe, expect, it } from 'vitest';
import { TEXT_HIDDEN, TOKEN_REDACTED, TRUST_REASON_MAX_CHARS } from '../client.constants.js';
import { refusalLine } from '../trust-reason.utils.js';

const TOKEN = 'k3Y9-realistic_token_AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const HALF = Math.floor(TOKEN.length / 2);
const MAX_OUT = TRUST_REASON_MAX_CHARS + 1;
const split = (between: string) => `${TOKEN.slice(0, HALF)}${between}${TOKEN.slice(HALF)}`;

describe('refusalLine', () => {
  it('cuts a megabyte on one line to at most 200 characters and an ellipsis', () => {
    const line = refusalLine({ text: 'y'.repeat(1_000_000), token: TOKEN });

    expect(line.length).toBeLessThanOrEqual(MAX_OUT);
    expect(line.endsWith('…')).toBe(true);
  });

  it('keeps one short line of a hundred thousand line breaks', () => {
    const line = refusalLine({ text: 'line\n'.repeat(100_000), token: TOKEN });

    expect(line).toBe('line');
  });

  it('hides the whole token where it is echoed whole, keeping the rest', () => {
    expect(refusalLine({ text: `bad ${TOKEN} bad`, token: TOKEN })).toBe(
      `bad ${TOKEN_REDACTED} bad`,
    );
  });

  it.each([
    ['a zero-width character', split('\u200b')],
    ['a combining mark', split('\u0301')],
    ['a variation selector', split('\ufe0f')],
    ['a Hangul filler', split('\u3164')],
    ['a newline', `${TOKEN.slice(0, HALF)}\n${TOKEN.slice(HALF)}`],
    ['an escape', split('\u001b')],
    ['a partial tail echo', `the token ends ${TOKEN.slice(-12)}`],
    ['a partial head echo', `${TOKEN.slice(0, 9)} is what it starts with`],
    ['a partial echo on a second line', `first\n${TOKEN.slice(10, 20)}`],
  ])('hides the whole text when it echoes the token with %s', (_title, text) => {
    expect(refusalLine({ text, token: TOKEN })).toBe(TEXT_HIDDEN);
  });

  it('matches a token with regex metacharacters only literally', () => {
    const token = '(a+b)*[c]?.$^|\\{1}x';

    expect(refusalLine({ text: `see ${token.slice(2, 12)}`, token })).toBe(TEXT_HIDDEN);
    expect(refusalLine({ text: 'see aab cc dd', token })).toBe('see aab cc dd');
  });

  it('hides a token shorter than 8 characters only when it appears whole', () => {
    expect(refusalLine({ text: 'bad abc here', token: 'abc' })).toBe(`bad ${TOKEN_REDACTED} here`);
    expect(refusalLine({ text: 'bad ab here', token: 'abc' })).toBe('bad ab here');
  });

  it('leaves the text unchanged for an empty token', () => {
    expect(refusalLine({ text: 'plain refusal', token: '' })).toBe('plain refusal');
  });

  it('does not hide an overlap of 7 characters, the window is 8', () => {
    const text = `x ${TOKEN.slice(0, 7)} y`;

    expect(refusalLine({ text, token: TOKEN })).toBe(text);
  });

  it('keeps an ordinary refusal and shows control characters', () => {
    expect(refusalLine({ text: 'forbidden: not yours', token: TOKEN })).toBe(
      'forbidden: not yours',
    );
    expect(refusalLine({ text: '\u001b[31mred', token: TOKEN })).not.toMatch(/\p{Cc}/u);
  });
});
