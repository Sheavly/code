import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineAdapter } from '@sheavly/core/adapter/adapter.utils';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { RESERVED_MODEL_FIELDS } from '@sheavly/protocol/model/model.constants';
import { adapterDescriptionSchema } from '@sheavly/protocol/model/model.validator';
import { createDefaultRegistry } from '../default-registry.helper.js';
import { AdapterRegistry } from '../registry.service.js';

const registry = createDefaultRegistry();
const described = registry.describe();

/**
 * A name a person would expect to be kept secret: one of its words (split at capitals) is a key,
 * secret, password, credential or token. The match is on whole words, so `maxTokens` and
 * `thinkingBudget`, which count language-model tokens, are not taken for credentials.
 */
const SECRET_WORDS = ['key', 'secret', 'password', 'credential', 'credentials', 'token'];
const LOOKS_SECRET = (name: string) =>
  name
    .split(/(?=[A-Z])/)
    .map((word) => word.toLowerCase())
    .some((word) => SECRET_WORDS.includes(word));

type Property = Record<string, unknown>;
const propertiesOf = (config: Record<string, unknown>) =>
  config.properties as Record<string, Property>;

describe('AdapterRegistry.describe', () => {
  it('describes every built-in adapter, in the order they were registered', () => {
    expect(described.map((adapter) => adapter.kind)).toEqual([
      'openai',
      'azure-openai',
      'azure-chat',
      'azure-anthropic',
      'bedrock-anthropic',
      'bedrock-openai',
    ]);
  });

  describe.each(described)('the $kind adapter', (adapter) => {
    it('is a description the protocol accepts, and survives being sent as JSON', () => {
      expect(adapterDescriptionSchema.parse(adapter)).toEqual(adapter);
      expect(JSON.parse(JSON.stringify(adapter))).toEqual(adapter);
    });

    it('leaves out what the host supplies: a person is never asked for the request policy', () => {
      expect(Object.keys(propertiesOf(adapter.config))).not.toContain('request');
      expect(adapter.config.required).not.toContain('request');
    });

    it('marks its key a secret, and lists it', () => {
      expect(adapter.secrets).toEqual(['apiKey']);
      expect(propertiesOf(adapter.config).apiKey).toMatchObject({ secret: true });
    });

    it('names the field that holds what the provider calls the model, and it is a field', () => {
      expect(adapter.remoteField).toBeDefined();
      expect(Object.keys(propertiesOf(adapter.config))).toContain(adapter.remoteField);
    });

    it('uses none of the names a model’s file keeps for itself', () => {
      for (const reserved of RESERVED_MODEL_FIELDS) {
        expect(Object.keys(propertiesOf(adapter.config))).not.toContain(reserved);
      }
    });

    it('marks every field that looks like a secret as one, so a new key can’t slip into a file', () => {
      for (const name of Object.keys(propertiesOf(adapter.config))) {
        if (LOOKS_SECRET(name)) expect(adapter.secrets, name).toContain(name);
      }
    });

    it('lists only the fields that must be given as required: defaults and options are not', () => {
      const required = (adapter.config.required ?? []) as string[];

      expect(required).toContain('apiKey');
      expect(required).not.toContain('reasoning');
      expect(required).not.toContain('apiVersion');
      expect(required).not.toContain('thinkingBudget');
    });
  });

  it('labels the fields a person fills in, so a form needs no per-provider code', () => {
    const azure = described.find((adapter) => adapter.kind === 'azure-openai');
    const fields = propertiesOf(azure?.config ?? {});

    expect(fields.apiKey).toMatchObject({ title: 'API key' });
    expect(fields.deployment).toMatchObject({ title: 'Deployment' });
    expect(fields.baseUrl).toMatchObject({ title: 'Endpoint' });
  });

  it('describes an adapter registered later, with no remote field when it has none', () => {
    const stub = defineAdapter({
      kind: 'stub',
      description: 'Fixed text',
      configSchema: z.object({ reply: z.string() }),
      create: (): Provider => ({
        async *stream() {
          await Promise.resolve();
          yield { type: 'done', stopReason: 'end_turn' };
        },
      }),
    });
    const [only] = new AdapterRegistry().register(stub).describe();

    expect(only).toMatchObject({ kind: 'stub', secrets: [] });
    expect(only).not.toHaveProperty('remoteField');
    expect(adapterDescriptionSchema.safeParse(only).success).toBe(true);
  });
});

describe('AdapterRegistry.secretFields', () => {
  it('names an adapter’s secrets, and refuses an adapter it does not have', () => {
    expect(registry.secretFields('azure-openai')).toEqual(['apiKey']);
    expect(() => registry.secretFields('nope')).toThrow('Unknown adapter: nope');
  });
});
