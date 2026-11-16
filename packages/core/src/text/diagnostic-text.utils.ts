import { MAX_PROVIDER_ERROR_CHARS, SECRET_NAMES } from './text.constants.js';

/**
 * Redacts common credential forms in exception text without examining request objects. This is
 * pattern matching, not a guarantee: it does not know the configured key, so a key written in an
 * unfamiliar form passes through.
 */
export function redactDiagnosticText(text: string): string {
  return (
    text
      .replace(
        /\b(?:Bearer|Basic)\s+[\w.~+/=-]{8,}/gi,
        (match) => `${match.split(/\s/)[0] ?? ''} [REDACTED]`,
      )
      .replace(/\b((?:Set-)?Cookie:\s*)[^\r\n]+/gi, '$1[REDACTED]')
      // A quoted value may hold spaces, so it ends at its closing quote.
      .replace(
        new RegExp(`(${SECRET_NAMES}["']?\\s*[:=]\\s*)(["'])[^"']*\\2`, 'gi'),
        '$1$2[REDACTED]$2',
      )
      .replace(
        new RegExp(`(${SECRET_NAMES}["']?\\s*[:=]\\s*)(?!["'])[^"'&\\s,;]+`, 'gi'),
        '$1[REDACTED]',
      )
      // A key echoed in prose ("Incorrect API key provided: abc...").
      .replace(/(\bkey provided:\s*)\S+/gi, '$1[REDACTED]')
      // A key in a URL query string.
      .replace(/([?&](?:key|sig|signature)=)[^&\s"']+/gi, '$1[REDACTED]')
      .replace(/\bsk-[\w-]{16,}\b/g, '[REDACTED]')
      // A bare 32-character or longer hex run, the shape of many providers' unprefixed keys.
      .replace(/\b[a-f0-9]{32,}\b/gi, '[REDACTED]')
  );
}

/**
 * Text from a model API that is safe to put in an error: credential forms redacted, whitespace
 * collapsed and the length bounded, since a provider can echo request fragments back.
 */
export function providerErrorText(text: string): string {
  // Control characters (an escape sequence, a carriage return) go with the whitespace: this text
  // reaches logs and terminals, and a provider or a stored source is not trusted not to send them.
  const flat = redactDiagnosticText(text.replaceAll(/[\s\p{Cc}]+/gu, ' ').trim());

  return flat.length > MAX_PROVIDER_ERROR_CHARS
    ? `${flat.slice(0, MAX_PROVIDER_ERROR_CHARS)}…`
    : flat;
}
