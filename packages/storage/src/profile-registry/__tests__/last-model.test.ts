import { describe, expect, it } from 'vitest';
import { ASTRA, BORA, GHOST, HOME, WORK, useTempRegistry } from '../../testing/registry.fake.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const temp = useTempRegistry();

describe('the model a profile last used', () => {
  it('is none for a new profile, and what was remembered after', async () => {
    const registry = temp.registry();

    await registry.put({ id: WORK, name: 'Work' });
    expect((await registry.get(WORK))?.lastModelSelection).toBeUndefined();

    await registry.rememberModel({ id: WORK, modelId: ASTRA });
    expect((await registry.get(WORK))?.lastModelSelection).toEqual({
      modelId: ASTRA,
      mode: 'medium',
    });

    await registry.rememberModel({ id: WORK, modelId: BORA });
    expect((await registry.get(WORK))?.lastModelSelection).toEqual({
      modelId: BORA,
      mode: 'medium',
    });
  });

  it('is a profile’s own: choosing in one never moves another’s', async () => {
    const registry = temp.registry();

    await registry.put({ id: WORK, name: 'Work' });
    await registry.put({ id: HOME, name: 'Home' });
    await registry.rememberModel({ id: WORK, modelId: ASTRA });

    expect((await registry.get(HOME))?.lastModelSelection).toBeUndefined();
  });

  it('survives a rename, which changes the name and nothing else', async () => {
    const registry = temp.registry();

    await registry.put({ id: WORK, name: 'Work' });
    await registry.rememberModel({ id: WORK, modelId: ASTRA });
    await registry.put({ id: WORK, name: 'Day job' });

    expect(await registry.get(WORK)).toEqual({
      id: WORK,
      name: 'Day job',
      lastModelSelection: { modelId: ASTRA, mode: 'medium' },
      modelModes: { [ASTRA]: 'medium' },
    });
  });

  it('keeps both a rename and a model chosen at the same time', async () => {
    const registry = temp.registry();

    await registry.put({ id: WORK, name: 'Work' });
    // Many at once, so a write that starts from stale contents loses the other's change.
    await Promise.all([
      ...Array.from({ length: 20 }, (_, index) =>
        registry.rememberModel({ id: WORK, modelId: index % 2 === 0 ? BORA : ASTRA }),
      ),
      registry.put({ id: WORK, name: 'Day job' }),
      registry.rememberModel({ id: WORK, modelId: ASTRA }),
    ]);

    expect(await registry.get(WORK)).toEqual({
      id: WORK,
      name: 'Day job',
      lastModelSelection: { modelId: ASTRA, mode: 'medium' },
      modelModes: { [ASTRA]: 'medium', [BORA]: 'medium' },
    });
  });

  it('remembers each model’s mode across switches and registry restarts', async () => {
    const registry = temp.registry();

    await registry.put({ id: WORK, name: 'Work' });
    await registry.rememberModel({ id: WORK, modelId: ASTRA, mode: 'extreme' });
    await registry.rememberModel({ id: WORK, modelId: BORA, mode: 'low' });
    await registry.rememberModel({ id: WORK, modelId: ASTRA });

    const file = path.join(temp.root(), 'profiles', WORK, 'profile.json');
    const saved = JSON.parse(await readFile(file, 'utf8')) as unknown;

    expect(saved).toMatchObject({
      lastModelSelection: { modelId: ASTRA, mode: 'extreme' },
      modelModes: { [ASTRA]: 'extreme', [BORA]: 'low' },
    });
  });

  it('keeps only what the schema knows: a lastModelId key selects nothing', async () => {
    const registry = temp.registry();

    await registry.put({ id: WORK, name: 'Work' });
    const file = path.join(temp.root(), 'profiles', WORK, 'profile.json');

    await writeFile(file, JSON.stringify({ id: WORK, name: 'Work', lastModelId: ASTRA }));
    expect(await registry.get(WORK)).toEqual({ id: WORK, name: 'Work' });
    await registry.put({ id: WORK, name: 'Renamed' });
    expect(await readFile(file, 'utf8')).not.toContain('lastModelId');
  });

  it('is refused for a profile that does not exist, and makes none', async () => {
    const registry = temp.registry();

    await expect(registry.rememberModel({ id: GHOST, modelId: ASTRA })).rejects.toMatchObject({
      name: 'RegistryError',
      reason: 'unknown_profile',
    });
    expect(await registry.get(GHOST)).toBeUndefined();
  });
});
