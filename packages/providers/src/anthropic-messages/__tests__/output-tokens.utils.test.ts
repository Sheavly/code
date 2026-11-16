import { describe, expect, it } from 'vitest';
import { messagesMaxTokens } from '../output-tokens.utils.js';

describe('messagesMaxTokens', () => {
  it('lets an explicit limit win over the table', () => {
    expect(messagesMaxTokens({ model: 'claude-sonnet-5-5', maxTokens: 4096 })).toBe(4096);
  });

  it('uses the documented limit for a recognized model', () => {
    expect(messagesMaxTokens({ model: 'claude-opus-5-5', maxTokens: undefined })).toBe(128_000);
  });

  it('matches model ids exactly', () => {
    expect(messagesMaxTokens({ model: 'Claude-Opus-5-5', maxTokens: undefined })).toBe(8192);
  });

  it('falls back for an unknown deployment', () => {
    expect(messagesMaxTokens({ model: 'custom', maxTokens: undefined })).toBe(8192);
  });
});
