import { describe, expect, it } from 'vitest';
import { chatMaxTokens } from '../output-tokens.utils.js';

describe('chatMaxTokens', () => {
  it('lets an explicit limit win over the table', () => {
    expect(chatMaxTokens({ model: 'deepseek-v4-flash', maxTokens: 1000 })).toBe(1000);
  });

  it('matches a recognized model case-insensitively', () => {
    expect(chatMaxTokens({ model: 'DeepSeek-V4-Flash', maxTokens: undefined })).toBe(384_000);
  });

  it('leaves an unknown deployment to the server', () => {
    expect(chatMaxTokens({ model: 'my-deployment', maxTokens: undefined })).toBeUndefined();
  });
});
