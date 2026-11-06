import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ProfileRegistry } from '../profile-registry.service.js';
import { ProfileStore } from '../../profile-store/profile-store.service.js';
import { ASTRA, HOME, WORK, useTempRegistry } from '../../testing/registry.fake.js';

const temp = useTempRegistry();

describe('global terminal settings', () => {
  it('persists across restarts without modifying profiles', async () => {
    const registry = temp.registry();

    await registry.setTerminalSettings({ reducedMotion: true });
    await registry.put({ id: WORK, name: 'Work' });
    await registry.put({ id: HOME, name: 'Home' });

    const restarted = new ProfileRegistry({ root: temp.root() });

    expect((await restarted.config()).terminal).toEqual({ reducedMotion: true });
    expect((await restarted.get(WORK))?.terminal).toBeUndefined();
    expect((await restarted.get(HOME))?.terminal).toBeUndefined();
  });

  it('keeps settings across profile changes, including deletion, and can turn motion off', async () => {
    const registry = temp.registry();

    await registry.put({ id: WORK, name: 'Work' });
    await registry.setTerminalSettings({ reducedMotion: true });
    await Promise.all([
      registry.put({ id: WORK, name: 'Day job' }),
      registry.rememberModel({ id: WORK, modelId: ASTRA, mode: 'high' }),
    ]);

    expect(await registry.get(WORK)).toMatchObject({
      name: 'Day job',
      lastModelSelection: { modelId: ASTRA, mode: 'high' },
    });
    expect((await registry.config()).terminal).toEqual({ reducedMotion: true });
    await registry.setTerminalSettings({ reducedMotion: false });
    expect((await registry.config()).terminal).toEqual({ reducedMotion: false });
    expect((await registry.get(WORK))?.modelModes).toEqual({ [ASTRA]: 'high' });
    await registry.delete(WORK);
    expect((await registry.config()).terminal).toEqual({ reducedMotion: false });
  });
});

describe('migrating legacy profile motion settings', () => {
  async function legacyProfiles() {
    const store = new ProfileStore({ root: temp.root() });

    await store.put({ id: WORK, name: 'Work', terminal: { reducedMotion: false } });
    await store.put({ id: HOME, name: 'Home', terminal: { reducedMotion: true } });
    await temp.registry().rememberModel({ id: WORK, modelId: ASTRA, mode: 'high' });
  }

  it('keeps reduced motion if any profile enabled it and removes legacy fields', async () => {
    await legacyProfiles();

    const registry = temp.registry();

    expect(await registry.migrateTerminalSettings()).toEqual({ reducedMotion: true });
    expect((await registry.config()).terminal).toEqual({ reducedMotion: true });
    expect(await registry.get(WORK)).toMatchObject({
      lastModelSelection: { modelId: ASTRA, mode: 'high' },
      modelModes: { [ASTRA]: 'high' },
    });

    for (const id of [WORK, HOME]) {
      const saved = JSON.parse(
        await readFile(path.join(temp.root(), 'profiles', id, 'profile.json'), 'utf8'),
      ) as unknown;

      expect(saved).not.toHaveProperty('terminal');
    }

    expect(await registry.migrateTerminalSettings()).toEqual({ reducedMotion: true });
  });

  it.each([{ reducedMotion: false }, {}])(
    'preserves an existing global choice: %j',
    async (settings) => {
      await legacyProfiles();
      await temp.registry().setTerminalSettings(settings);

      expect(await temp.registry().migrateTerminalSettings()).toEqual(settings);
      expect((await temp.registry().get(HOME))?.terminal).toBeUndefined();
    },
  );

  it('cannot recreate a profile deleted while migration is queued', async () => {
    await legacyProfiles();

    const registry = temp.registry();

    await Promise.all([registry.migrateTerminalSettings(), registry.delete(HOME)]);
    expect(await registry.get(HOME)).toBeUndefined();
    expect((await registry.config()).terminal).toEqual({ reducedMotion: true });
  });

  it('saves an explicitly disabled legacy preference and leaves a fresh config unwritten', async () => {
    const registry = temp.registry();

    expect(await registry.migrateTerminalSettings()).toEqual({});
    await expect(readFile(path.join(temp.root(), 'config.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await new ProfileStore({ root: temp.root() }).put({
      id: WORK,
      name: 'Work',
      terminal: { reducedMotion: false },
    });
    expect(await registry.migrateTerminalSettings()).toEqual({ reducedMotion: false });
  });

  it('can resume cleanup after a failed write without replacing a later global choice', async () => {
    await legacyProfiles();

    const registry = temp.registry();
    const write = vi
      .spyOn(ProfileStore.prototype, 'put')
      .mockRejectedValueOnce(new Error('write failed'));

    try {
      await expect(registry.migrateTerminalSettings()).rejects.toThrow('write failed');
    } finally {
      write.mockRestore();
    }

    expect((await registry.config()).terminal).toEqual({ reducedMotion: true });
    expect((await registry.get(HOME))?.terminal).toEqual({ reducedMotion: true });
    await registry.setTerminalSettings({ reducedMotion: false });
    expect(await registry.migrateTerminalSettings()).toEqual({ reducedMotion: false });
    expect((await registry.get(HOME))?.terminal).toBeUndefined();
  });
});
