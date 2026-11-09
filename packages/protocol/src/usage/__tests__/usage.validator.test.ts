import { describe, expect, it } from 'vitest';
import { contextUsageSchema, modelUsageSchema, tokenUsageSchema } from '../usage.validator.js';

describe('reported usage', () => {
  const tokens = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0 };

  it('accepts explicit unknown usage and explicit zero-cost reports', () => {
    expect(modelUsageSchema.parse({ tokens: null })).toEqual({ tokens: null });
    expect(modelUsageSchema.parse({ tokens, estimatedCostUsd: 0 })).toEqual({
      tokens,
      estimatedCostUsd: 0,
    });
  });

  it('carries the window a call ran against, and refuses one that is not a positive whole number', () => {
    expect(modelUsageSchema.parse({ tokens, contextWindow: 300_000 }).contextWindow).toBe(300_000);
    expect(modelUsageSchema.safeParse({ tokens, contextWindow: 0 }).success).toBe(false);
    expect(modelUsageSchema.safeParse({ tokens, contextWindow: 1.5 }).success).toBe(false);
  });

  it('refuses negative, fractional and inconsistent cache counts', () => {
    expect(tokenUsageSchema.safeParse({ ...tokens, outputTokens: -1 }).success).toBe(false);
    expect(tokenUsageSchema.safeParse({ ...tokens, inputTokens: 1.5 }).success).toBe(false);
    expect(tokenUsageSchema.safeParse({ ...tokens, cacheReadTokens: 101 }).success).toBe(false);
    expect(modelUsageSchema.safeParse({ tokens, estimatedCostUsd: -1 }).success).toBe(false);
  });

  it('keeps missing context measurements unknown and validates reported counts', () => {
    expect(contextUsageSchema.parse({ throughSeq: -1 })).toEqual({ throughSeq: -1 });
    expect(contextUsageSchema.parse({ throughSeq: 4, used: 0, window: 300_000 })).toEqual({
      throughSeq: 4,
      used: 0,
      window: 300_000,
    });
    expect(contextUsageSchema.safeParse({ throughSeq: 0, used: -1 }).success).toBe(false);
    expect(contextUsageSchema.safeParse({ throughSeq: 0, window: 0 }).success).toBe(false);
    expect(contextUsageSchema.safeParse({ throughSeq: -2 }).success).toBe(false);
  });
});
