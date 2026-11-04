import { describe, expect, it } from 'vitest';
import { modelFileSchema } from '../model.validator.js';
import { fileIsNamedForItsId, toModel, toModelFile } from '../model.utils.js';

const ID = '0b6c2f1e-3a4d-4c8e-9f10-7a2b5d6e8c01';
const OTHER = '9d3e7a52-1c46-4b0f-8e21-5f6a7b8c9d02';
const read = (json: unknown) => modelFileSchema.parse(json);

describe('toModel', () => {
  it('splits a file into its id, name and adapter, and the adapter’s definition', () => {
    const file = read({
      id: ID,
      name: 'Astra 6',
      adapter: 'azure',
      baseUrl: 'https://acme.test',
      deployment: 'gpt-5',
    });

    expect(toModel(file)).toEqual({
      id: ID,
      name: 'Astra 6',
      adapter: 'azure',
      definition: { baseUrl: 'https://acme.test', deployment: 'gpt-5' },
    });
  });

  it('gives a model with no fields of its own an empty definition', () => {
    expect(toModel(read({ id: ID, name: 'Plain', adapter: 'openai' })).definition).toEqual({});
  });
});

describe('toModelFile', () => {
  it('writes the id, name and adapter with the adapter’s fields', () => {
    const model = toModel(read({ id: ID, name: 'Astra 6', adapter: 'azure', deployment: 'gpt-5' }));

    expect(toModelFile(model)).toEqual({
      id: ID,
      name: 'Astra 6',
      adapter: 'azure',
      deployment: 'gpt-5',
    });
  });

  it('reads back as the same model: a file survives being written and read', () => {
    const model = toModel(
      read({ id: ID, name: 'Astra 6', adapter: 'azure', baseUrl: 'https://a.test' }),
    );

    expect(toModel(read(toModelFile(model)))).toEqual(model);
  });

  it('keeps the model’s own id, name and adapter when a definition holds fields of those names', () => {
    const model = toModel(read({ id: ID, name: 'Astra 6', adapter: 'azure' }));
    const clashing = { ...model, definition: { id: OTHER, name: 'Other', adapter: 'x' } };

    expect(toModelFile(clashing)).toMatchObject({ id: ID, name: 'Astra 6', adapter: 'azure' });
  });
});

describe('fileIsNamedForItsId', () => {
  const file = read({ id: ID, name: 'Astra 6', adapter: 'azure' });

  it('accepts the file whose name is its id', () => {
    expect(fileIsNamedForItsId({ stem: ID, file })).toBe(true);
  });

  it('refuses a copy under another name, so two files can’t claim one model', () => {
    expect(fileIsNamedForItsId({ stem: OTHER, file })).toBe(false);
    expect(fileIsNamedForItsId({ stem: 'astra-6', file })).toBe(false);
  });
});
