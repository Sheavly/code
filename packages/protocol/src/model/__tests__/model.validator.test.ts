import { describe, expect, it } from 'vitest';
import { RESERVED_MODEL_FIELDS } from '../model.constants.js';
import {
  adapterDescriptionSchema,
  keyCheckSchema,
  modelFileSchema,
  modelIdSchema,
  modelSchema,
} from '../model.validator.js';

const ID = '0b6c2f1e-3a4d-4c8e-9f10-7a2b5d6e8c01';

describe('the model envelope fields', () => {
  it('are the same in the file, the API model and the reserved list', () => {
    const fileFields = Object.keys(modelFileSchema.shape).sort();
    const modelFields = Object.keys(modelSchema.shape).filter((key) => key !== 'definition');

    expect(modelFields.sort()).toEqual(fileFields);
    expect([...RESERVED_MODEL_FIELDS].sort()).toEqual(fileFields);
  });
});

describe('modelIdSchema', () => {
  it('takes a lowercase UUID, which is safe to be a file name', () => {
    expect(modelIdSchema.parse(ID)).toBe(ID);
    expect(modelIdSchema.parse(crypto.randomUUID())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses anything else: a name, a path, an uppercase UUID, a nearly-UUID', () => {
    for (const id of [
      '',
      'astra-6',
      '..',
      '../secrets',
      `${ID}.json`,
      ID.toUpperCase(),
      ID.slice(1),
      `${ID}/x`,
      ID.replace('-', '_'),
    ]) {
      expect(modelIdSchema.safeParse(id).success, id).toBe(false);
    }
  });
});

describe('modelFileSchema', () => {
  const file = {
    id: ID,
    name: 'Astra 6',
    adapter: 'azure-openai',
    baseUrl: 'https://acme.openai.azure.com/openai/v1',
    deployment: 'gpt-5',
  };

  it('reads an id, a name, an adapter, and passes the adapter’s own fields on', () => {
    expect(modelFileSchema.parse(file)).toEqual(file);
  });

  it('needs all three: the file has to say what it is', () => {
    for (const missing of ['id', 'name', 'adapter']) {
      const { [missing]: _left, ...rest } = file as Record<string, unknown>;

      expect(modelFileSchema.safeParse(rest).success, missing).toBe(false);
    }
  });

  it('refuses an empty name, and one that is only spaces; it trims the rest', () => {
    expect(modelFileSchema.safeParse({ ...file, name: '' }).success).toBe(false);
    expect(modelFileSchema.safeParse({ ...file, name: '   ' }).success).toBe(false);
    expect(modelFileSchema.parse({ ...file, name: '  Astra 6  ' }).name).toBe('Astra 6');
  });

  it('refuses an adapter that is not a lowercase kind', () => {
    for (const adapter of ['', 'A/B', 'Azure', '../x', 'a b']) {
      expect(modelFileSchema.safeParse({ ...file, adapter }).success, adapter).toBe(false);
    }
  });
});

describe('modelSchema', () => {
  it('has an id, a name, the adapter and its definition', () => {
    const model = { id: ID, name: 'Astra 6', adapter: 'azure-openai', definition: { a: 1 } };

    expect(modelSchema.parse(model)).toEqual(model);
    expect(modelSchema.safeParse({ ...model, name: undefined }).success).toBe(false);
  });
});

describe('adapterDescriptionSchema', () => {
  it('describes an adapter: kind, text, the form as JSON Schema, and which fields are secret', () => {
    const description = {
      kind: 'azure-openai',
      description: 'Azure Responses API',
      config: { type: 'object', properties: { apiKey: { type: 'string', secret: true } } },
      secrets: ['apiKey'],
      remoteField: 'deployment',
    };

    expect(adapterDescriptionSchema.parse(description)).toEqual(description);
  });

  it('says which field is what the provider calls the model, when the adapter has one', () => {
    const base = { kind: 'stub', description: 'Fixed text', config: {}, secrets: [] };

    expect(adapterDescriptionSchema.safeParse(base).success).toBe(true);
    expect(adapterDescriptionSchema.parse({ ...base, remoteField: 'model' }).remoteField).toBe(
      'model',
    );
    expect(adapterDescriptionSchema.safeParse({ ...base, remoteField: '' }).success).toBe(false);
  });
});

describe('keyCheckSchema', () => {
  it('is valid with nothing else, or a failure with its fixed message', () => {
    expect(keyCheckSchema.parse({ status: 'valid' })).toEqual({ status: 'valid' });

    for (const status of ['invalid', 'not_found', 'rejected', 'unreachable']) {
      expect(keyCheckSchema.parse({ status, message: 'text' })).toEqual({
        status,
        message: 'text',
      });
    }
  });

  it('refuses a failure without a message, and a status it does not have', () => {
    expect(keyCheckSchema.safeParse({ status: 'invalid' }).success).toBe(false);
    expect(keyCheckSchema.safeParse({ status: 'expired', message: 'x' }).success).toBe(false);
  });
});
