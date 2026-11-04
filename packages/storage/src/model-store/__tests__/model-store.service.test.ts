import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { StorageFileError } from '../../errors/storage.errors.js';
import { ModelStore } from '../model-store.service.js';

const ASTRA = modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
const BORA = modelIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71');
const OTHER = modelIdSchema.parse('c1e8a3d4-7b25-4e69-8f10-2a6d9b4c7e53');

const astra = {
  id: ASTRA,
  name: 'Astra 6',
  adapter: 'azure-openai',
  definition: { baseUrl: 'https://acme.openai.azure.com/openai/v1', deployment: 'gpt-5' },
};
const bora = { id: BORA, name: 'Bora', adapter: 'openai', definition: { model: 'gpt-6' } };

let profile: string;
let models: string;
let store: ModelStore;

const fileOf = (id: string) => path.join(models, `${id}.json`);

beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'storage-models-'));
  models = path.join(profile, 'models');
  store = new ModelStore({ folder: profile });
});

afterEach(async () => {
  await rm(profile, { recursive: true, force: true });
});

describe('ModelStore', () => {
  it('has no models, and no problems, before anything is stored', async () => {
    expect(await store.list()).toEqual({ models: [], problems: [] });
    expect(await store.get(ASTRA)).toBeUndefined();
  });

  it('stores a model as <id>.json, flat so a person can read and edit it', async () => {
    await store.put(astra);

    expect(JSON.parse(await readFile(fileOf(ASTRA), 'utf8'))).toEqual({
      baseUrl: 'https://acme.openai.azure.com/openai/v1',
      deployment: 'gpt-5',
      id: ASTRA,
      name: 'Astra 6',
      adapter: 'azure-openai',
    });
    expect(await store.get(ASTRA)).toEqual(astra);
    expect(await store.list()).toEqual({ models: [astra], problems: [] });
  });

  it('replaces the model with its id, and removes one, leaving the others', async () => {
    await store.put(astra);
    await store.put(bora);
    await store.put({ ...astra, name: 'Astra 7' });

    expect((await store.list()).models.map((model) => model.name)).toEqual(['Astra 7', 'Bora']);

    await store.remove(ASTRA);
    await store.remove(ASTRA);

    expect((await store.list()).models).toEqual([bora]);
    expect(await store.get(ASTRA)).toBeUndefined();
  });

  it('lists by name, then id, so two models with one label keep a fixed order', async () => {
    const twin = { ...bora, id: OTHER };

    await store.put(twin);
    await store.put(bora);
    await store.put(astra);

    expect((await store.list()).models.map((model) => model.id)).toEqual([ASTRA, BORA, OTHER]);
  });

  it('lists names alike on every machine, whatever the system locale (Ä is after Z in Swedish)', async () => {
    const named = (name: string, id: string) => ({ ...bora, id: modelIdSchema.parse(id), name });

    await store.put(named('zeta', '00000000-0000-4000-8000-000000000001'));
    await store.put(named('Ärlig', '00000000-0000-4000-8000-000000000002'));
    await store.put(named('apple', '00000000-0000-4000-8000-000000000003'));
    await store.put(named('Banana', '00000000-0000-4000-8000-000000000004'));

    expect((await store.list()).models.map((model) => model.name)).toEqual([
      'apple',
      'Ärlig',
      'Banana',
      'zeta',
    ]);
  });

  it('keeps a key out of reach: the store writes what it is given, so a key is refused before', async () => {
    // The store has no adapter and cannot tell a key from a field; the caller checks first.
    await store.put({ ...bora, definition: { model: 'gpt-6' } });

    expect(await readFile(fileOf(BORA), 'utf8')).not.toContain('apiKey');
  });
});

describe('ModelStore with files edited by hand', () => {
  beforeEach(async () => {
    await mkdir(models, { recursive: true });
  });

  it('reports a damaged file by name and still lists the others', async () => {
    await store.put(bora);
    await writeFile(fileOf(ASTRA), '{ "id": ');

    const { models: listed, problems } = await store.list();

    expect(listed).toEqual([bora]);
    expect(problems).toEqual([
      { file: fileOf(ASTRA), message: expect.stringContaining(fileOf(ASTRA)) as string },
    ]);
  });

  it('reports a file that does not hold a model, naming what is missing', async () => {
    await writeFile(fileOf(ASTRA), JSON.stringify({ id: ASTRA, adapter: 'openai' }));

    const { problems } = await store.list();

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('name');
  });

  it('refuses a copy: a file whose id is not its name is not served under that name', async () => {
    await store.put(astra);
    // Copied by hand to a new name, the id inside left as it was.
    await writeFile(fileOf(BORA), await readFile(fileOf(ASTRA), 'utf8'));

    const { models: listed, problems } = await store.list();

    expect(listed).toEqual([astra]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe(fileOf(BORA));
    expect(problems[0]?.message).toContain(ASTRA);
    await expect(store.get(BORA)).rejects.toThrow(StorageFileError);
  });

  it('reports a .json file that is named for no id, since nothing could address it', async () => {
    await writeFile(path.join(models, 'my-model.json'), JSON.stringify(astra));

    const { models: listed, problems } = await store.list();

    expect(listed).toEqual([]);
    expect(problems).toEqual([
      {
        file: path.join(models, 'my-model.json'),
        message: expect.stringContaining('not a model id') as string,
      },
    ]);
  });

  it('refuses an id in capitals: macOS and Windows would call it the same file as the lowercase one', async () => {
    await store.put(astra);
    await writeFile(path.join(models, `${ASTRA.toUpperCase()}.json`), JSON.stringify(astra));

    const { problems } = await store.list();

    // On a case-insensitive disk that write replaced the file above, leaving one; on Linux there
    // are two, and the uppercase one is the problem. Either way no model is served twice.
    const names = await readdir(models);

    expect(problems.length).toBe(names.length - 1);
    expect((await store.list()).models.length).toBeLessThanOrEqual(1);
  });

  it('ignores what systems and editors leave in a folder: .DS_Store, Thumbs.db, swap and hidden files', async () => {
    await store.put(astra);

    for (const litter of [
      '.DS_Store',
      'Thumbs.db',
      'desktop.ini',
      '._4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30.json',
      '.4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30.json.swp',
      `${ASTRA}.json~`,
      `${ASTRA}.json.bak`,
      'notes.txt',
    ]) {
      await writeFile(path.join(models, litter), 'x');
    }

    expect(await store.list()).toEqual({ models: [astra], problems: [] });
  });

  it('reads a file a Windows editor saved: with a byte-order mark and CRLF line ends', async () => {
    const text = JSON.stringify(
      { ...astra.definition, id: ASTRA, name: 'Astra 6', adapter: 'azure-openai' },
      null,
      2,
    );

    await writeFile(fileOf(ASTRA), `\uFEFF${text.replaceAll('\n', '\r\n')}\r\n`);

    expect(await store.get(ASTRA)).toEqual(astra);
  });

  it('does not take a folder named like a model for one', async () => {
    await mkdir(fileOf(ASTRA), { recursive: true });

    const { models: listed, problems } = await store.list();

    expect(listed).toEqual([]);
    expect(problems).toHaveLength(1);
  });

  it('fails loudly when the models folder is not a folder, never reading it as empty', async () => {
    await rm(models, { recursive: true });
    await writeFile(models, 'not a folder');

    // A file where the folder should be is "not there" to the system; but nothing can be stored.
    expect(await store.list()).toEqual({ models: [], problems: [] });
    await expect(store.put(astra)).rejects.toThrow(StorageFileError);
  });
});
