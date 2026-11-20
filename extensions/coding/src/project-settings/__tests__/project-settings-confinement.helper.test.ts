import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectSettingsFileExists, readProjectSettings } from '../project-settings.helper.js';

/** Symbolic links need a privilege on Windows that tests can't count on. */
const itWithSymlinks = process.platform === 'win32' ? it.skip : it;
const SECRET = 'sk-live-do-not-leak-0123456789';
let base: string;
let root: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'project-settings-confine-'));
  root = path.join(base, 'project');
  outside = path.join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function expectRefusedWithoutContent(result: unknown, reason = 'link'): void {
  expect(result).toEqual({
    ok: false,
    path: path.join(root, '.sheavly', 'settings.json'),
    reason,
  });
  expect(JSON.stringify(result)).not.toContain(SECRET);
  expect(JSON.stringify(result)).not.toContain(outside);
}

/** A project whose settings.json is a link to a secret file outside it. */
async function linkSettingsToOutsideSecret(): Promise<void> {
  await writeFile(path.join(outside, 'secret.txt'), SECRET);
  await mkdir(path.join(root, '.sheavly'));
  await symlink(path.join(outside, 'secret.txt'), path.join(root, '.sheavly', 'settings.json'));
}

describe('readProjectSettings: confinement', () => {
  itWithSymlinks(
    'refuses a settings.json that links to a secret file outside the project',
    async () => {
      await linkSettingsToOutsideSecret();

      expectRefusedWithoutContent(await readProjectSettings({ root }));
    },
  );

  itWithSymlinks(
    'refuses a settings.json that links to a file elsewhere in the project',
    async () => {
      await writeFile(path.join(root, 'notes.txt'), SECRET);
      await mkdir(path.join(root, '.sheavly'));
      await symlink(path.join(root, 'notes.txt'), path.join(root, '.sheavly', 'settings.json'));

      expectRefusedWithoutContent(await readProjectSettings({ root }));
    },
  );

  itWithSymlinks(
    'refuses a .sheavly folder that links to a folder outside the project',
    async () => {
      await writeFile(path.join(outside, 'settings.json'), JSON.stringify({ settings: SECRET }));
      await symlink(outside, path.join(root, '.sheavly'));

      expectRefusedWithoutContent(await readProjectSettings({ root }));
    },
  );

  itWithSymlinks(
    'refuses a .sheavly folder that links to another folder inside the project',
    async () => {
      await mkdir(path.join(root, 'config'));
      await writeFile(path.join(root, 'config', 'settings.json'), SECRET);
      await symlink(path.join(root, 'config'), path.join(root, '.sheavly'));

      expectRefusedWithoutContent(await readProjectSettings({ root }));
    },
  );

  itWithSymlinks(
    'reads through a project root that is itself a link, since the folder is real inside it',
    async () => {
      await mkdir(path.join(root, '.sheavly'));
      await writeFile(path.join(root, '.sheavly', 'settings.json'), '{}');
      await symlink(root, path.join(base, 'alias'));

      expect(await readProjectSettings({ root: path.join(base, 'alias') })).toMatchObject({
        ok: true,
        text: '{}',
      });
    },
  );

  it('accepts a settings.json that is a hard link to a file outside the project', async () => {
    const text = '{ "settings": {} }';

    await writeFile(path.join(outside, 'shared.json'), text);
    await mkdir(path.join(root, '.sheavly'));
    await link(path.join(outside, 'shared.json'), path.join(root, '.sheavly', 'settings.json'));

    expect(await readProjectSettings({ root })).toMatchObject({ ok: true, text });
  });

  itWithSymlinks(
    'says a linked settings.json exists, so the caller still checks trust',
    async () => {
      await linkSettingsToOutsideSecret();

      expect(await projectSettingsFileExists({ root })).toBe(true);
    },
  );

  it('refuses a root with .. components that leads to a project whose .sheavly is not plain', async () => {
    await mkdir(path.join(root, '.sheavly', 'settings.json'), { recursive: true });

    const result = await readProjectSettings({ root: path.join(root, '..', 'project') });

    // A real, plain .sheavly folder whose settings.json is a folder.
    expectRefusedWithoutContent(result, 'not-a-file');
  });
});
