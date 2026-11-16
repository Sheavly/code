import { describe, expect, it } from 'vitest';
import { providerErrorText } from '../diagnostic-text.utils.js';
import { MAX_PROVIDER_ERROR_CHARS } from '../text.constants.js';

describe('providerErrorText', () => {
  it('redacts a key a provider echoes back', () => {
    const text = providerErrorText('Incorrect API key provided: sk-abcdefghijklmnopqrstuvwx');

    expect(text).not.toContain('sk-abcdef');
    expect(text).toContain('[REDACTED]');
  });

  it('collapses whitespace so an error stays one line', () => {
    expect(providerErrorText('bad\n  request \t here')).toBe('bad request here');
  });

  it('removes control characters, so text cannot drive a terminal or forge a log line', () => {
    expect(providerErrorText('a\u001b[2Jb\rc\u0000d')).toBe('a [2Jb c d');
  });

  it('bounds the length, marking the cut', () => {
    const text = providerErrorText('x'.repeat(MAX_PROVIDER_ERROR_CHARS * 2));

    expect(text).toHaveLength(MAX_PROVIDER_ERROR_CHARS + 1);
    expect(text.endsWith('…')).toBe(true);
  });

  it('leaves a short ordinary message alone', () => {
    expect(providerErrorText('high demand')).toBe('high demand');
  });
});
