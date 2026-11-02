import { describe, expect, it } from 'vitest';
import { apiKeySchema, baseUrlSchema, reasoningSchema } from '../adapter-config.validator.js';

describe('adapter config schemas', () => {
  it('strips trailing slashes from a base URL', () => {
    expect(baseUrlSchema.parse('https://api.example.test/v1///')).toBe(
      'https://api.example.test/v1',
    );
  });

  it('rejects a base URL that is not a URL', () => {
    expect(baseUrlSchema.safeParse('api.example.test').success).toBe(false);
  });

  it('rejects an empty API key', () => {
    expect(apiKeySchema.safeParse('').success).toBe(false);
    expect(apiKeySchema.parse('sk-1')).toBe('sk-1');
  });

  it('takes reasoning as a boolean only', () => {
    expect(reasoningSchema.safeParse('true').success).toBe(false);
    expect(reasoningSchema.parse(false)).toBe(false);
  });
});
