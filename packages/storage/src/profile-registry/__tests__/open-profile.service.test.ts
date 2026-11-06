import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { filesHolding as holding } from '@sheavly/testing/files/files-holding.fake';
import { RegistryError } from '../../errors/registry.errors.js';
import {
  ASTRA,
  BORA,
  GHOST,
  WORK,
  twoModels,
  useTempRegistry,
} from '../../testing/registry.fake.js';

/** A key no other string could be: finding it anywhere it should not be means it leaked. */
const KEY = 'sk-LEAK-CHECK-5b91e7d3c0';
const work = { id: WORK, name: 'Work' };
const { astra, bora } = twoModels();
const temp = useTempRegistry();

/** A profile that exists, opened. */
async function openWork() {
  await temp.registry().put(work);

  return temp.registry().open(WORK);
}

/** The files of the profile's folder, at any depth, whose content has `text` in it. */
async function filesHolding(text: string): Promise<string[]> {
  return holding({ folder: path.join(temp.root(), 'profiles', WORK), text });
}

const refused = (reason: string): unknown =>
  expect.objectContaining({ name: 'RegistryError', reason });

describe('OpenProfile models and keys', () => {
  it('keeps a model and its key apart: the key is never in the model', async () => {
    const profile = await openWork();

    await profile.putModel(astra);
    await profile.putSecrets({ id: ASTRA, secrets: { apiKey: KEY } });

    expect(await profile.getModel(ASTRA)).toEqual(astra);
    expect(await profile.getSecrets(ASTRA)).toEqual({ apiKey: KEY });
    expect(JSON.stringify(await profile.listModels())).not.toContain(KEY);
    expect(
      await readFile(path.join(temp.root(), 'profiles', WORK, 'models', `${ASTRA}.json`), 'utf8'),
    ).not.toContain(KEY);
  });

  it('says which fields are set and never what they hold', async () => {
    const profile = await openWork();

    await profile.putModel(astra);
    await profile.putSecrets({ id: ASTRA, secrets: { apiKey: KEY } });

    expect(await profile.secretFields()).toEqual({ [ASTRA]: ['apiKey'] });
    expect(JSON.stringify(await profile.secretFields())).not.toContain(KEY);
  });

  it('removes a model with its key, and leaves the other models and their keys', async () => {
    const profile = await openWork();

    await profile.putModel(astra);
    await profile.putModel(bora);
    await profile.putSecrets({ id: ASTRA, secrets: { apiKey: KEY } });
    await profile.putSecrets({ id: BORA, secrets: { apiKey: 'other' } });
    await profile.removeModel(ASTRA);

    expect(await profile.getModel(ASTRA)).toBeUndefined();
    expect(await profile.getSecrets(ASTRA)).toBeUndefined();
    expect(await profile.secretFields()).toEqual({ [BORA]: ['apiKey'] });
    expect((await profile.listModels()).models).toEqual([bora]);
    // Not hidden by the store: the removed key is in no file of the profile, temp files included.
    expect(await filesHolding(KEY)).toEqual([]);
    expect(await filesHolding('other')).not.toEqual([]);
  });

  it('removes a key left from a model whose file is already gone, and removing nothing is fine', async () => {
    const profile = await openWork();

    await profile.putModel(astra);
    await profile.putSecrets({ id: ASTRA, secrets: { apiKey: KEY } });
    await rm(path.join(temp.root(), 'profiles', WORK, 'models', `${ASTRA}.json`));
    await profile.removeModel(ASTRA);
    await profile.removeModel(ASTRA);

    expect(await profile.secretFields()).toEqual({});
  });

  it('forgets a model’s key and keeps the model, and forgetting none is fine', async () => {
    const profile = await openWork();

    await profile.putModel(astra);
    await profile.putSecrets({ id: ASTRA, secrets: { apiKey: KEY } });
    await profile.removeSecrets(ASTRA);
    await profile.removeSecrets(ASTRA);

    expect(await profile.getModel(ASTRA)).toEqual(astra);
    expect(await profile.getSecrets(ASTRA)).toBeUndefined();
    expect(await filesHolding(KEY)).toEqual([]);
  });

  it('will not set a key for a model the profile does not have', async () => {
    const profile = await openWork();

    await profile.putModel(astra);
    await expect(profile.putSecrets({ id: BORA, secrets: { apiKey: KEY } })).rejects.toEqual(
      refused('unknown_model'),
    );
    expect(await profile.secretFields()).toEqual({});
  });

  it('keeps every key when several are set at the same moment, through the one queue', async () => {
    const profile = await openWork();
    const ids = [ASTRA, BORA];

    await profile.putModel(astra);
    await profile.putModel(bora);
    // Opened again, as a second request would: the same object, so the same queue.
    const again = await temp.registry().open(WORK);

    await Promise.all([
      profile.putSecrets({ id: ids[0] ?? ASTRA, secrets: { apiKey: 'one' } }),
      again.putSecrets({ id: ids[1] ?? BORA, secrets: { apiKey: 'two' } }),
    ]);

    expect(await profile.getSecrets(ASTRA)).toEqual({ apiKey: 'one' });
    expect(await profile.getSecrets(BORA)).toEqual({ apiKey: 'two' });
  });
});

describe('OpenProfile after its profile is deleted', () => {
  it('does not recreate the profile as a folder holding one model or one key', async () => {
    const profile = await openWork();

    await profile.putModel(astra);
    await temp.registry().delete(WORK);

    await expect(profile.putModel(bora)).rejects.toEqual(refused('unknown_profile'));
    await expect(profile.putSecrets({ id: ASTRA, secrets: { apiKey: KEY } })).rejects.toEqual(
      refused('unknown_profile'),
    );
    expect((await temp.registry().list()).profiles).toEqual([]);
    expect((await temp.registry().list()).problems).toEqual([]);
  });

  it('refuses with a RegistryError, not a storage failure', async () => {
    const profile = await openWork();

    await temp.registry().delete(WORK);

    await expect(profile.putModel(astra)).rejects.toBeInstanceOf(RegistryError);
  });

  it('is told about a profile that is not there, never one that is merely damaged', async () => {
    const profile = await openWork();

    await writeFile(path.join(temp.root(), 'profiles', WORK, 'profile.json'), '{ not json');

    // A damaged profile.json is a storage failure to fix, not "no such profile".
    await expect(profile.putModel(astra)).rejects.not.toBeInstanceOf(RegistryError);
    await expect(temp.registry().open(GHOST)).rejects.toBeInstanceOf(RegistryError);
  });
});
