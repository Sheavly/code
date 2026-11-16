import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { StorageFileError } from '../../errors/storage.errors.js';
import { ConfigStore } from '../config-store.service.js';
import { workspaceKey } from '../config-store.utils.js';

const WORK = profileIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
const HOME = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71');
const app = workspaceKey({ realPath: '/code/app', platform: 'posix' });
const site = workspaceKey({ realPath: '/code/site', platform: 'posix' });
const notes = workspaceKey({ realPath: '/code/notes', platform: 'posix' });

let root: string;
let store: ConfigStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'storage-config-'));
  store = new ConfigStore({ root });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('ConfigStore', () => {
  it('keeps global terminal settings and bindings through concurrent changes and profile deletion', async () => {
    await Promise.all([
      store.setTerminalSettings({ reducedMotion: true }),
      store.setDefaultProfile(WORK),
      store.bindWorkspace({ key: app, profile: HOME }),
    ]);
    expect(await store.read()).toEqual({
      terminal: { reducedMotion: true },
      defaultProfile: WORK,
      workspaces: { [app]: HOME },
    });
    await store.forgetProfile(WORK);
    await store.unbindWorkspace(app);
    expect(await store.read()).toEqual({ terminal: { reducedMotion: true }, workspaces: {} });
  });

  it('starts with no default profile and no bindings, and resolves nothing', async () => {
    expect(await store.read()).toEqual({ workspaces: {} });
    expect(await store.profileFor(app)).toBeUndefined();
  });

  it('uses the default profile for a workspace not bound to one', async () => {
    await store.setDefaultProfile(HOME);

    expect(await store.profileFor(app)).toBe(HOME);
    expect(await store.read()).toEqual({ defaultProfile: HOME, workspaces: {} });
  });

  it('lets a workspace use another profile than the default, and go back', async () => {
    await store.setDefaultProfile(HOME);
    await store.bindWorkspace({ key: app, profile: WORK });

    expect(await store.profileFor(app)).toBe(WORK);
    expect(await store.profileFor(site)).toBe(HOME);

    await store.bindWorkspace({ key: app, profile: HOME });
    expect(await store.profileFor(app)).toBe(HOME);

    await store.bindWorkspace({ key: app, profile: WORK });
    await store.unbindWorkspace(app);
    await store.unbindWorkspace(app);
    expect(await store.profileFor(app)).toBe(HOME);
  });

  it('binds a workspace even before there is a default', async () => {
    await store.bindWorkspace({ key: app, profile: WORK });

    expect(await store.profileFor(app)).toBe(WORK);
    expect(await store.profileFor(site)).toBeUndefined();
  });

  it('stores ids only, in a file a person can read: no name, no path', async () => {
    await store.setDefaultProfile(HOME);
    await store.bindWorkspace({ key: app, profile: WORK });

    expect(JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'))).toEqual({
      defaultProfile: HOME,
      workspaces: { [app]: WORK },
    });
  });

  it('forgets a deleted profile everywhere: as the default, and in every binding to it', async () => {
    await store.setDefaultProfile(WORK);
    await store.bindWorkspace({ key: app, profile: WORK });
    await store.bindWorkspace({ key: site, profile: HOME });
    await store.bindWorkspace({ key: notes, profile: WORK });
    await store.forgetProfile(WORK);

    expect(await store.read()).toEqual({ workspaces: { [site]: HOME } });
    expect(await store.profileFor(app)).toBeUndefined();
    expect(await store.profileFor(site)).toBe(HOME);
  });

  it('keeps the default and the bindings of profiles it was not asked to forget', async () => {
    await store.setDefaultProfile(HOME);
    await store.bindWorkspace({ key: app, profile: WORK });
    await store.forgetProfile(WORK);
    await store.forgetProfile(WORK);

    expect(await store.read()).toEqual({ defaultProfile: HOME, workspaces: {} });
  });

  it('does not lose a change when many are made at the same moment', async () => {
    const keys = Array.from({ length: 20 }, (_, index) =>
      workspaceKey({ realPath: `/code/app-${String(index)}`, platform: 'posix' }),
    );

    await Promise.all(
      keys.map((key, index) => store.bindWorkspace({ key, profile: index % 2 ? WORK : HOME })),
    );

    for (const [index, key] of keys.entries()) {
      expect(await store.profileFor(key)).toBe(index % 2 ? WORK : HOME);
    }
  });
});

describe('ConfigStore with a file that is not right', () => {
  const file = () => path.join(root, 'config.json');

  it('reads a file saved by hand: a byte-order mark, CRLF, and no bindings written yet', async () => {
    await writeFile(file(), `\uFEFF{\r\n  "defaultProfile": "${HOME}"\r\n}\r\n`);

    expect(await store.read()).toEqual({ defaultProfile: HOME, workspaces: {} });
  });

  it('refuses a file naming something that is not a profile id or a workspace key', async () => {
    for (const bad of [
      { defaultProfile: 'work' },
      { workspaces: { 'my-project': WORK } },
      { workspaces: { [app]: 'work' } },
    ]) {
      await writeFile(file(), JSON.stringify(bad));
      await expect(store.read()).rejects.toThrow(StorageFileError);
      await expect(store.read()).rejects.toThrow(file());
    }
  });

  it('never replaces a file it cannot read: a change stops instead', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(file(), '{ not json');

    await expect(store.setDefaultProfile(HOME)).rejects.toThrow(StorageFileError);
    expect(await readFile(file(), 'utf8')).toBe('{ not json');
  });

  it('keeps going after a change that failed: the next is not stuck behind it', async () => {
    await writeFile(file(), '{ not json');
    await expect(store.setDefaultProfile(HOME)).rejects.toThrow(StorageFileError);

    await rm(file());
    await store.setDefaultProfile(WORK);

    expect(await store.profileFor(app)).toBe(WORK);
  });
});
