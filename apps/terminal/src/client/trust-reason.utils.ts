import { plainTerminalText } from '../render/terminal-text.utils.js';
import {
  TEXT_HIDDEN,
  TOKEN_ECHO_CHARS,
  TOKEN_REDACTED,
  TRUST_REASON_MAX_CHARS,
} from './client.constants.js';

/** `text` with every occurrence of `token` replaced; an empty token hides nothing. */
function hideToken(params: { text: string; token: string }): string {
  const { text, token } = params;

  return token === '' ? text : text.split(token).join(TOKEN_REDACTED);
}

/** Whether `text` holds any run of `TOKEN_ECHO_CHARS` consecutive characters of `token`. */
function echoesToken(params: { text: string; token: string }): boolean {
  const { text, token } = params;
  const size = Math.min(TOKEN_ECHO_CHARS, token.length);

  for (let start = 0; start + size <= token.length; start += 1) {
    if (text.includes(token.slice(start, start + size))) return true;
  }

  return false;
}

/** `text` with what a reader skips over (marks, controls, format characters, blanks) removed. */
function withoutInvisible(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{M}\p{Z}\u3164\u115f\u1160]/gu, '');
}

/**
 * What a backend's refusal may show on a terminal: its first line only, with every control
 * character (newlines and tabs too) made visible or collapsed, `token` hidden wherever it is
 * echoed whole, and at most `TRUST_REASON_MAX_CHARS` characters (then an ellipsis). A text that
 * holds any 8 consecutive characters of the token, as it came, as one line or with invisible
 * characters removed, is replaced entirely: a split or partial echo is not told apart from a
 * leak. An empty token hides nothing.
 */
export function refusalLine(params: { text: string; token: string }): string {
  const { text, token } = params;
  const redacted = hideToken({ text, token });
  const [firstLine = ''] = redacted.split(/[\n\r\u2028\u2029]/u);
  const plain = hideToken({
    text: plainTerminalText(firstLine).replace(/\s+/gu, ' ').trim(),
    token,
  });

  if (token !== '') {
    const seen = [redacted, plain, withoutInvisible(redacted)];

    if (seen.some((candidate) => echoesToken({ text: candidate, token }))) return TEXT_HIDDEN;
  }

  if (plain.length <= TRUST_REASON_MAX_CHARS) return plain;

  return `${plain.slice(0, TRUST_REASON_MAX_CHARS)}…`;
}
