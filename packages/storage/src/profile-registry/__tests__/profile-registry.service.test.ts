import { chmod, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { workspaceKey } from '../../config-store/config-store.utils.js';
import { RegistryError } from '../../errors/registry.errors.js';
import { StorageFileError } from '../../errors/storage.errors.js';
import { GHOST, HOME, WORK, useTempRegistry } from '../../testing/registry.fake.js';

const work = { id: WORK, name: 'Work' };
const home = { id: HOME, name: 'Home' };
const app = workspaceKey({ realPath: '/code/app', platform: 'posix' });
const site = workspaceKey({ realPath: '/code/site', platform: 'posix' });
const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0;
const temp = useTempRegistry();

const refusal = (reason: string): unknown =>
  expect.objectContaining({ name: 'RegistryError', reason });
const exists = async (target: string) => {
  try {
    await stat(target);

    return true;
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return false;
    throw caughtError;
  }
};

describe('ProfileRegistry profiles', () => {
  it('makes, lists, renames and gets profiles', async () => {
    const registry = temp.registry();

    await registry.put(home);
    await registry.put(work);
    await registry.put({ id: WORK, name: 'Day job' });

    expect((await registry.list()).profiles).toEqual([{ id: WORK, name: 'Day job' }, home]);
    expect(await registry.get(HOME)).toEqual(home);
    expect(await registry.get(GHOST)).toBeUndefined();
  });

  it('opens a profile that exists, and refuses one that does not', async () => {
    const registry = temp.registry();

    await registry.put(work);

    expect((await registry.open(WORK)).id).toBe(WORK);
    await expect(registry.open(GHOST)).rejects.toEqual(refusal('unknown_profile'));
    await expect(registry.open(GHOST)).rejects.toBeInstanceOf(RegistryError);
  });

  it('hands out one object per profile, even when opened at the same moment', async () => {
    const registry = temp.registry();

    await registry.put(work);
    await registry.put(home);

    const [a, b, c] = await Promise.all([
      registry.open(WORK),
      registry.open(WORK),
      registry.open(WORK),
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(await registry.open(WORK)).toBe(a);
    expect(await registry.open(HOME)).not.toBe(a);
  });
});

describe('ProfileRegistry config', () => {
  beforeEach(async () => {
    await temp.registry().put(work);
    await temp.registry().put(home);
  });

  it('sets the default and binds workspaces only to profiles that exist', async () => {
    const registry = temp.registry();

    await registry.setDefaultProfile(HOME);
    await registry.bindWorkspace({ key: app, profile: WORK });

    expect(await registry.config()).toEqual({
      defaultProfile: HOME,
      workspaces: { [app]: WORK },
    });
    await expect(registry.setDefaultProfile(GHOST)).rejects.toEqual(refusal('unknown_profile'));
    await expect(registry.bindWorkspace({ key: site, profile: GHOST })).rejects.toEqual(
      refusal('unknown_profile'),
    );
    expect(await registry.config()).toEqual({ defaultProfile: HOME, workspaces: { [app]: WORK } });
  });

  it('gives a workspace its binding, else the default, else nothing', async () => {
    const registry = temp.registry();

    expect(await registry.profileFor(app)).toBeUndefined();

    await registry.setDefaultProfile(HOME);
    await registry.bindWorkspace({ key: app, profile: WORK });

    expect(await registry.profileFor(app)).toEqual(work);
    expect(await registry.profileFor(site)).toEqual(home);

    await registry.unbindWorkspace(app);
    expect(await registry.profileFor(app)).toEqual(home);
  });

  it('falls back when what the config names is gone, as when a folder was deleted by hand', async () => {
    const registry = temp.registry();

    await registry.setDefaultProfile(HOME);
    await registry.bindWorkspace({ key: app, profile: WORK });
    await rm(path.join(temp.root(), 'profiles', WORK), { recursive: true });

    expect(await registry.profileFor(app)).toEqual(home);

    await rm(path.join(temp.root(), 'profiles', HOME), { recursive: true });
    expect(await registry.profileFor(app)).toBeUndefined();
  });
});

describe('ProfileRegistry.delete', () => {
  it('removes a profile with its folder, its default and its bindings, and nothing else', async () => {
    const registry = temp.registry();

    await registry.put(work);
    await registry.put(home);
    await registry.setDefaultProfile(WORK);
    await registry.bindWorkspace({ key: app, profile: WORK });
    await registry.bindWorkspace({ key: site, profile: HOME });
    await registry.delete(WORK);

    expect(await registry.get(WORK)).toBeUndefined();
    expect(await registry.config()).toEqual({ workspaces: { [site]: HOME } });
    expect((await registry.list()).profiles).toEqual([home]);
  });

  it('never leaves the config naming a profile that a racing delete removed', async () => {
    const registry = temp.registry();

    await registry.put(work);
    await registry.put(home);

    const settled = await Promise.allSettled([
      registry.setDefaultProfile(WORK),
      registry.bindWorkspace({ key: app, profile: WORK }),
      registry.delete(WORK),
    ]);

    expect(settled[2]?.status).toBe('fulfilled');
    expect(await registry.config()).toEqual({ workspaces: {} });
  });

  it('forgets the profile it opened: opening it again says it is gone', async () => {
    const registry = temp.registry();

    await registry.put(work);

    const before = await registry.open(WORK);

    await registry.delete(WORK);
    await expect(registry.open(WORK)).rejects.toEqual(refusal('unknown_profile'));
    await registry.put(work);
    expect(await registry.open(WORK)).not.toBe(before);
  });

  it.skipIf(!canChmod)(
    'forgets the config before it removes the folder, so a failure never leaves the config dangling',
    async () => {
      const registry = temp.registry();
      const profiles = path.join(temp.root(), 'profiles');

      await registry.put(work);
      await registry.setDefaultProfile(WORK);
      // The folder cannot be removed: its parent is read-only.
      await chmod(profiles, 0o500);

      await expect(registry.delete(WORK)).rejects.toBeInstanceOf(StorageFileError);

      // Still there, and no longer named: deleting it again, when it can be, finishes the job.
      expect(await registry.get(WORK)).toEqual(work);
      expect(await registry.config()).toEqual({ workspaces: {} });

      await chmod(profiles, 0o700);
      await registry.delete(WORK);
      expect(await exists(path.join(profiles, WORK))).toBe(false);
    },
  );
});
