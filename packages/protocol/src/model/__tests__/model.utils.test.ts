import { describe, expect, it } from 'vitest';
import { modelFileSchema } from '../model.validator.js';
import { fileIsNamedForItsId, toModel, toModelFile } from '../model.utils.js';
import { RESERVED_MODEL_FIELDS } from '../model.constants.js';

const ID = '0b6c2f1e-3a4d-4c8e-9f10-7a2b5d6e8c01';
const OTHER = '9d3e7a52-1c46-4b0f-8e21-5f6a7b8c9d02';
const read = (json: unknown) => modelFileSchema.parse(json);

describe('toModel', () => {
  it('does not promote optional envelope metadata from adapter configuration', () => {
    const model = toModel(read({ id: ID, name: 'Test', adapter: 'openai', model: 'm' }));
    const file = toModelFile({
      ...model,
      definition: { ...model.definition, pricing: { input: 1 }, identity: { model: 'injected' } },
    });

    expect(file).not.toHaveProperty('pricing');
    expect(file).not.toHaveProperty('identity');
    expect(file.model).toBe('m');
  });

  it('reserves every envelope field so metadata cannot collide with adapter configuration', () => {
    expect([...RESERVED_MODEL_FIELDS].sort()).toEqual(Object.keys(modelFileSchema.shape).sort());
  });
  it('keeps chosen identity independent of hosting and deployment across a round trip', () => {
    const identity = { model: 'claude-opus-5-5', family: 'claude' };
    const file = read({
      id: ID,
      name: 'Production',
      adapter: 'azure-anthropic',
      deployment: 'prod',
      identity,
    });
    const model = toModel(file);

    expect(model.identity).toEqual(identity);
    expect(model.definition).toEqual({ deployment: 'prod' });
    expect(toModelFile(model)).toEqual(file);
    const { identity: _identity, ...legacy } = model;

    expect(toModelFile({ ...legacy, definition: { identity } })).not.toHaveProperty('identity');
  });
  it('keeps prices in the envelope, out of the adapter definition, across a round trip', () => {
    const pricing = { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 };
    const file = read({ id: ID, name: 'Priced', adapter: 'openai', model: 'm', pricing });
    const model = toModel(file);

    expect(model.definition).toEqual({ model: 'm' });
    expect(model.pricing).toEqual(pricing);
    expect(toModelFile(model)).toEqual(file);
    expect(modelFileSchema.safeParse({ ...file, pricing: { ...pricing, input: -1 } }).success).toBe(
      false,
    );
  });
  it('keeps the context window in the envelope, out of the adapter’s definition', () => {
    const model = toModel(
      read({ id: ID, name: 'Astra 6', adapter: 'openai', contextWindow: 1_000_000 }),
    );

    expect(model.contextWindow).toBe(1_000_000);
    expect(model.definition).toEqual({});
    expect(toModel(read(toModelFile(model)))).toEqual(model);
  });

  it('does not promote a context window from adapter configuration', () => {
    const model = toModel(read({ id: ID, name: 'Plain', adapter: 'openai' }));

    expect(toModelFile({ ...model, definition: { contextWindow: 5 } })).not.toHaveProperty(
      'contextWindow',
    );
  });

  it('splits a file into its id, name and adapter, and the adapter’s definition', () => {
    const file = read({
      id: ID,
      name: 'Astra 6',
      adapter: 'azure-openai',
      baseUrl: 'https://acme.test',
      deployment: 'gpt-5',
    });

    expect(toModel(file)).toEqual({
      id: ID,
      name: 'Astra 6',
      adapter: 'azure-openai',
      definition: { baseUrl: 'https://acme.test', deployment: 'gpt-5' },
    });
  });

  it('gives a model with no fields of its own an empty definition', () => {
    expect(toModel(read({ id: ID, name: 'Plain', adapter: 'openai' })).definition).toEqual({});
  });
});

describe('toModelFile', () => {
  it('writes the id, name and adapter with the adapter’s fields', () => {
    const model = toModel(
      read({ id: ID, name: 'Astra 6', adapter: 'azure-openai', deployment: 'gpt-5' }),
    );

    expect(toModelFile(model)).toEqual({
      id: ID,
      name: 'Astra 6',
      adapter: 'azure-openai',
      deployment: 'gpt-5',
    });
  });

  it('reads back as the same model: a file survives being written and read', () => {
    const model = toModel(
      read({ id: ID, name: 'Astra 6', adapter: 'azure-openai', baseUrl: 'https://a.test' }),
    );

    expect(toModel(read(toModelFile(model)))).toEqual(model);
  });

  it('keeps the model’s own id, name and adapter when a definition holds fields of those names', () => {
    const model = toModel(read({ id: ID, name: 'Astra 6', adapter: 'azure-openai' }));
    const clashing = { ...model, definition: { id: OTHER, name: 'Other', adapter: 'x' } };

    expect(toModelFile(clashing)).toMatchObject({
      id: ID,
      name: 'Astra 6',
      adapter: 'azure-openai',
    });
  });
});

describe('fileIsNamedForItsId', () => {
  const file = read({ id: ID, name: 'Astra 6', adapter: 'azure-openai' });

  it('accepts the file whose name is its id', () => {
    expect(fileIsNamedForItsId({ stem: ID, file })).toBe(true);
  });

  it('refuses a copy under another name, so two files can’t claim one model', () => {
    expect(fileIsNamedForItsId({ stem: OTHER, file })).toBe(false);
    expect(fileIsNamedForItsId({ stem: 'astra-6', file })).toBe(false);
  });
});
