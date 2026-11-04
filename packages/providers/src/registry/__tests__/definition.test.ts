import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../default-registry.helper.js';

const registry = createDefaultRegistry();
const HOST = { request: { responseTimeoutMs: 60_000, retries: 2, retryDelayMs: 1000 } };
const azure = {
  baseUrl: 'https://acme.openai.azure.com/openai/v1',
  deployment: 'gpt-5',
};
const fieldsOf = (problems: { field: string }[]) => problems.map((problem) => problem.field);

describe('AdapterRegistry.validateDefinition', () => {
  it('accepts a definition that is complete without its key', () => {
    expect(registry.validateDefinition({ kind: 'azure', definition: azure, host: HOST })).toEqual(
      [],
    );
    expect(
      registry.validateDefinition({ kind: 'openai', definition: { model: 'gpt-6' }, host: HOST }),
    ).toEqual([]);
  });

  it('names a missing field, and one that is wrong, but never the missing key', () => {
    const problems = registry.validateDefinition({
      kind: 'azure',
      definition: { baseUrl: 'not a url' },
      host: HOST,
    });

    expect(fieldsOf(problems)).toEqual(expect.arrayContaining(['baseUrl', 'deployment']));
    expect(fieldsOf(problems)).not.toContain('apiKey');
  });

  it('applies the adapter’s own rules to the definition', () => {
    const claude = {
      baseUrl: 'https://acme.services.ai.azure.com/anthropic',
      deployment: 'claude',
      maxTokens: 1000,
    };

    expect(
      registry.validateDefinition({ kind: 'azure-anthropic', definition: claude, host: HOST }),
    ).toEqual([]);
    expect(
      fieldsOf(
        registry.validateDefinition({
          kind: 'azure-anthropic',
          definition: { ...claude, thinkingBudget: 5000 },
          host: HOST,
        }),
      ),
    ).toEqual(['thinkingBudget']);
    expect(
      fieldsOf(
        registry.validateDefinition({
          kind: 'azure-anthropic',
          definition: { ...claude, thinkingBudget: 100 },
          host: HOST,
        }),
      ),
    ).toContain('thinkingBudget');
  });

  it('refuses a key in the definition: a model’s file holds none', () => {
    const problems = registry.validateDefinition({
      kind: 'azure',
      definition: { ...azure, apiKey: 'sk-real-key' },
      host: HOST,
    });

    expect(problems).toEqual([
      { field: 'apiKey', message: expect.stringContaining('holds no secret') as string },
    ]);
    // The message names the field, not the key.
    expect(JSON.stringify(problems)).not.toContain('sk-real-key');
  });

  it('does not let a definition override what the host supplies', () => {
    const problems = registry.validateDefinition({
      kind: 'azure',
      definition: { ...azure, request: { responseTimeoutMs: -1 } },
      host: HOST,
    });

    expect(problems).toEqual([]);
  });

  it('refuses an adapter it does not have', () => {
    expect(() => registry.validateDefinition({ kind: 'nope', definition: {}, host: HOST })).toThrow(
      'Unknown adapter: nope',
    );
  });
});
