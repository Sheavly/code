import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Model } from '@sheavly/protocol/model/model.types';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { useTempFolders } from '@sheavly/testing/files/temp-folders.fake';
import { SetupError } from '../../errors/setup.errors.js';
import { testBackend } from '../../testing/backend.fake.js';
import { readUserSettingLayers } from '../setting-layers.helper.js';

const WORK = profileIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
const HOME = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71');
const WORK_MODEL = modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a31');
const HOME_MODEL = modelIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b72');
/** A value that must never show up in an error, a log line or the details. */
const SECRET = 'sk-SECRET-value-1234';

const folders = useTempFolders({ prefix: 'layered-settings-served-', names: ['app'] });
const sheavly = () => path.join(folders.base, 'sheavly');
const globalFile = () => path.join(sheavly(), 'settings.json');
const profileFile = (profile: string) => path.join(sheavly(), 'profiles', profile, 'settings.json');
const projectFile = () => path.join(folders.app, '.sheavly', 'settings.json');

const model = (id: typeof WORK_MODEL, name: string): Model => ({
  id,
  name,
  adapter: 'openai',
  definition: { model: `gpt-${name.toLowerCase()}` },
});

/** A backend whose own folder is `app`, with two profiles, Work (the default) and Home. */
async function backendWithTwoProfiles() {
  const made = testBackend({ home: sheavly(), workspace: folders.app });

  for (const [id, name, modelId] of [
    [WORK, 'Work', WORK_MODEL],
    [HOME, 'Home', HOME_MODEL],
  ] as const) {
    await made.setup.putProfile({ id, name });
    await made.setup.putModel({ profile: id, id: modelId, model: model(modelId, name) });
    await made.setup.putCredential({
      profile: id,
      model: modelId,
      secrets: { apiKey: `key-${name}` },
    });
  }

  await made.setup.setDefaultProfile(WORK);

  return made;
}

async function writeText(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** The message a refused start gives; fails the test if the start went through. */
async function refusalOf(start: Promise<unknown>): Promise<string> {
  const caught = await start.then(
    () => undefined,
    (caughtError: unknown) => caughtError,
  );

  expect(caught).toBeInstanceOf(SetupError);

  return (caught as Error).message;
}

describe('the user’s settings files when a conversation starts', () => {
  it('refuses a malformed global file, naming it and never its content', async () => {
    const made = await backendWithTwoProfiles();

    await writeText(globalFile(), `{"settings": {"notes.mode": "${SECRET}"`);

    const message = await refusalOf(made.conversations.start());

    expect(message).toContain(globalFile());
    expect(message).not.toContain('SECRET');
  });

  it('refuses a global value no installed extension declares, naming the file', async () => {
    const made = await backendWithTwoProfiles();

    await writeText(globalFile(), JSON.stringify({ settings: { 'nobody.declares': 1 } }));

    const message = await refusalOf(made.conversations.start());

    expect(message).toContain('nobody.declares');
    expect(message).toContain(globalFile());
  });

  it('reads the bound profile’s file only: a malformed one in another profile does not matter', async () => {
    const made = await backendWithTwoProfiles();

    await writeText(profileFile(HOME), `{"settings": {"notes.mode": "${SECRET}"`);

    const message = await refusalOf(made.conversations.start({ profile: HOME }));

    expect(message).toContain(profileFile(HOME));
    expect(message).not.toContain('SECRET');
    expect(await made.conversations.start({ profile: WORK })).toBeTruthy();
    await made.conversations.closeAll();
  });

  it('reads each profile’s own file, and the global one for every profile', async () => {
    const env = { SHEAVLY_HOME: sheavly() };

    await writeText(globalFile(), JSON.stringify({ settings: { 'notes.mode': 'g' } }));
    await writeText(profileFile(WORK), JSON.stringify({ settings: { 'notes.mode': 'work' } }));
    await writeText(profileFile(HOME), JSON.stringify({ settings: { 'notes.mode': 'home' } }));

    const work = await readUserSettingLayers({ env, profile: WORK });
    const home = await readUserSettingLayers({ env, profile: HOME });

    expect(work.profile).toEqual({ source: profileFile(WORK), values: { 'notes.mode': 'work' } });
    expect(home.profile).toEqual({ source: profileFile(HOME), values: { 'notes.mode': 'home' } });
    expect(work.global).toEqual({ source: globalFile(), values: { 'notes.mode': 'g' } });
    expect(home.global).toEqual(work.global);
  });

  it('starts with no layers when no file is there', async () => {
    const layers = await readUserSettingLayers({ env: { SHEAVLY_HOME: sheavly() }, profile: WORK });

    expect(layers).toEqual({ global: undefined, profile: undefined });
  });
});

describe('a user’s settings file that cannot be used, through the API', () => {
  it.each([
    ['global', () => globalFile(), {}, `{"settings": {"notes.mode": "${SECRET}"`],
    ['profile', () => profileFile(HOME), { profile: HOME }, `{"settings": ["${SECRET}"]}`],
  ])(
    'answers 422 naming the malformed %s file, and never its content',
    async (_layer, file, body, text) => {
      const made = await backendWithTwoProfiles();

      await writeText(file(), text);

      const response = await made.call('/conversations', { method: 'POST', body });
      const answer = await response.text();

      expect(response.status).toBe(422);
      expect(JSON.parse(answer)).toMatchObject({
        error: { code: 'bad_request', message: expect.stringContaining(file()) as string },
      });
      expect(answer).not.toContain('SECRET');
      expect(made.logged.join('')).not.toContain('SECRET');
    },
  );

  it('answers 422 for a file that is a folder, naming it', async () => {
    const made = await backendWithTwoProfiles();

    await mkdir(globalFile(), { recursive: true });

    const response = await made.call('/conversations', { method: 'POST', body: {} });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(globalFile());
  });

  it('still starts the other profile over HTTP', async () => {
    const made = await backendWithTwoProfiles();

    await writeText(profileFile(HOME), '{ not json');

    const response = await made.call('/conversations', { method: 'POST', body: { profile: WORK } });

    expect(response.status).toBe(201);
    await made.conversations.closeAll();
  });
});

describe('what the workspace’s file asked for that did not apply', () => {
  it('is in the details and the log, by name and reason, and never with a value', async () => {
    const made = await backendWithTwoProfiles();

    await writeText(
      projectFile(),
      JSON.stringify({ settings: { 'openai.api-key': SECRET, 'nobody.declares': 1 } }),
    );

    const id = await made.conversations.start();
    const details = await made.conversations.details(id);

    expect(details.ignoredSettings).toEqual([
      { layer: 'workspace', name: 'openai.api-key', file: projectFile(), reason: 'not-declared' },
      { layer: 'workspace', name: 'nobody.declares', file: projectFile(), reason: 'not-declared' },
    ]);
    expect(made.logged).toContain(
      `settings: ignored openai.api-key from ${projectFile()}: not-declared\n`,
    );
    expect(JSON.stringify(details) + made.logged.join('')).not.toContain('SECRET');
    await made.conversations.closeAll();
  });

  it('reports a whole file that cannot be used, and still starts', async () => {
    const made = await backendWithTwoProfiles();

    await writeText(projectFile(), `{"settings": {"__proto__": "${SECRET}"}}`);

    const id = await made.conversations.start();
    const details = await made.conversations.details(id);

    expect(details.ignoredSettings).toEqual([
      { layer: 'workspace', file: projectFile(), reason: 'bad-shape' },
    ]);
    expect(made.logged).toContain(`settings: ignored ${projectFile()}: bad-shape\n`);
    expect(JSON.stringify(details) + made.logged.join('')).not.toContain('SECRET');
    await made.conversations.closeAll();
  });

  it('leaves the field out of the details when nothing was ignored', async () => {
    const made = await backendWithTwoProfiles();
    const id = await made.conversations.start();

    expect(await made.conversations.details(id)).not.toHaveProperty('ignoredSettings');
    await made.conversations.closeAll();
  });
});
