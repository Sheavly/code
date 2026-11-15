import { describe, expect, it } from 'vitest';
import { DefinitionError } from '../../errors/definition.errors.js';
import { defineHook, handlerNames, hasHandler } from '../hook.utils.js';

describe('handlerNames', () => {
  it('lists every handler, including the summary ones, and never the name', () => {
    expect(handlerNames()).toEqual([
      'sessionStart',
      'beforeTurn',
      'beforeModelCall',
      'beforeSummary',
      'afterSummary',
      'aroundToolCall',
      'afterTurn',
      'taskCompleted',
      'notice',
      'approval',
      'sessionEnd',
      'onError',
    ]);
  });

  it('has no duplicate and never lists the name', () => {
    expect(new Set(handlerNames()).size).toBe(handlerNames().length);
    expect(handlerNames()).not.toContain('name');
  });

  it.each(handlerNames())('counts %s as a handler', (name) => {
    const hook = { name: 'any', [name]: async () => undefined };

    expect(hasHandler(hook)).toBe(true);
  });
});

describe('hasHandler', () => {
  it('counts beforeModelCall as a handler', () => {
    expect(hasHandler({ name: 'trim', beforeModelCall: async ({ messages }) => messages })).toBe(
      true,
    );
  });

  it('counts beforeSummary as a handler', () => {
    expect(hasHandler({ name: 'keep', beforeSummary: async () => undefined })).toBe(true);
  });

  it('counts afterSummary as a handler', () => {
    expect(hasHandler({ name: 'restore', afterSummary: async () => undefined })).toBe(true);
  });

  it('is false for a hook with only a name', () => {
    expect(hasHandler({ name: 'idle' })).toBe(false);
  });
});

describe('defineHook', () => {
  it('returns a beforeModelCall hook as it is', () => {
    const hook = { name: 'trim', beforeModelCall: async () => [] };

    expect(defineHook(hook)).toBe(hook);
  });

  it('returns a summary hook as it is', () => {
    const hook = { name: 'keep', beforeSummary: async () => ({ keepTokens: 1000 }) };

    expect(defineHook(hook)).toBe(hook);
  });

  it('rejects a hook that handles nothing', () => {
    expect(() => defineHook({ name: 'idle' })).toThrow(DefinitionError);
  });
});
