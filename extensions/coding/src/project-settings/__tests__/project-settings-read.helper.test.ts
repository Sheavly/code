import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_PROJECT_SETTINGS_BYTES } from '../project-settings.constants.js';
import { projectSettingsFileExists, readProjectSettings } from '../project-settings.helper.js';

const SECRET = 'sk-live-do-not-leak-0123456789';
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'project-settings-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSettings(content: string | Buffer): Promise<void> {
  await mkdir(path.join(root, '.sheavly'), { recursive: true });
  await writeFile(path.join(root, '.sheavly', 'settings.json'), content);
}

describe('readProjectSettings: what is read', () => {
  it('returns the text and the path of a file that is there', async () => {
    const text = '{ "settings": { "notes.max-lines": 5 } }\n';

    await writeSettings(text);

    expect(await readProjectSettings({ root })).toEqual({
      ok: true,
      text,
      path: path.join(root, '.sheavly', 'settings.json'),
    });
    expect(await projectSettingsFileExists({ root })).toBe(true);
  });

  it('is undefined, an empty layer, when there is no .sheavly folder', async () => {
    expect(await readProjectSettings({ root })).toBeUndefined();
    expect(await projectSettingsFileExists({ root })).toBe(false);
  });

  it('is undefined when .sheavly has no settings.json', async () => {
    await mkdir(path.join(root, '.sheavly'));

    expect(await readProjectSettings({ root })).toBeUndefined();
    expect(await projectSettingsFileExists({ root })).toBe(false);
  });

  it('is undefined when the project folder itself is not there', async () => {
    const missing = path.join(root, 'nowhere');

    expect(await readProjectSettings({ root: missing })).toBeUndefined();
    expect(await projectSettingsFileExists({ root: missing })).toBe(false);
  });

  it('reads a project root written with .. components', async () => {
    await writeSettings('{}');
    await mkdir(path.join(root, 'sub'));

    const result = await readProjectSettings({ root: path.join(root, 'sub', '..') });

    expect(result).toMatchObject({
      ok: true,
      text: '{}',
      path: path.join(root, '.sheavly', 'settings.json'),
    });
  });
});

describe('readProjectSettings: the size cap and the kind of file', () => {
  it('reads a file of exactly the cap', async () => {
    await writeSettings(' '.repeat(MAX_PROJECT_SETTINGS_BYTES));

    expect(await readProjectSettings({ root })).toMatchObject({ ok: true });
  });

  it('refuses a file over the cap without reading it, with the code too-large', async () => {
    await writeSettings(`${SECRET}${' '.repeat(MAX_PROJECT_SETTINGS_BYTES)}`);

    const result = await readProjectSettings({ root });

    expect(result).toEqual({
      ok: false,
      path: path.join(root, '.sheavly', 'settings.json'),
      reason: 'too-large',
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('refuses a settings.json that is a directory with the code not-a-file, and still says it exists', async () => {
    await mkdir(path.join(root, '.sheavly', 'settings.json'), { recursive: true });

    expect(await projectSettingsFileExists({ root })).toBe(true);
    expect(await readProjectSettings({ root })).toMatchObject({ ok: false, reason: 'not-a-file' });
  });

  it('refuses a file that is not valid UTF-8 with the code not-utf8, never quoting it', async () => {
    await writeSettings(Buffer.from([...Buffer.from(SECRET), 0xff, 0xfe, 0xc3]));

    const result = await readProjectSettings({ root });

    expect(result).toMatchObject({ ok: false, reason: 'not-utf8' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('refuses a settings.json it cannot open with the code unreadable', async () => {
    await writeSettings('{}');
    await chmod(path.join(root, '.sheavly', 'settings.json'), 0o000);

    const result = await readProjectSettings({ root });

    // Root can read a mode 000 file, so only a process bound by permissions refuses it.
    expect(result).toMatchObject(
      process.getuid?.() === 0 ? { ok: true } : { ok: false, reason: 'unreadable' },
    );
  });

  it('refuses a .sheavly that is a file, not a folder, or reports it absent', async () => {
    await writeFile(path.join(root, '.sheavly'), SECRET);

    const result = await readProjectSettings({ root });

    expect(JSON.stringify(result ?? null)).not.toContain(SECRET);
    expect(await projectSettingsFileExists({ root })).toBe(false);
  });
});
