import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { useTempFolders } from '@sheavly/testing/files/temp-folders.fake';
import { testBackend } from '../../testing/backend.fake.js';

const AZURE = profileIdSchema.parse('a8e3c1d7-5f2b-4b96-8d40-6c7e9a1b2f50');
const BEDROCK = profileIdSchema.parse('e2b6d4f8-1a3c-4d57-9b82-3f5a7c9e1d61');
const AZURE_MODEL = modelIdSchema.parse('a8e3c1d7-5f2b-4b96-8d40-6c7e9a1b2f51');
const BEDROCK_MODEL = modelIdSchema.parse('e2b6d4f8-1a3c-4d57-9b82-3f5a7c9e1d62');

const folders = useTempFolders({ prefix: 'concurrent-profile-starts-', names: ['app'] });
const sheavly = () => path.join(folders.base, 'sheavly');

/** A backend with two ready profiles, Azure the default, set up the way a UI does. */
async function twoProfiles() {
  const { fetch } = fakeFetchSequence({ responses: [] });
  const made = testBackend({ home: sheavly(), workspace: folders.app, fetch });

  for (const [id, name, modelId] of [
    [AZURE, 'Azure', AZURE_MODEL],
    [BEDROCK, 'Bedrock', BEDROCK_MODEL],
  ] as const) {
    await made.setup.putProfile({ id, name });
    await made.setup.putModel({
      profile: id,
      id: modelId,
      model: { name, adapter: 'openai', definition: { model: `gpt-${name}` } },
    });
    await made.setup.putCredential({ profile: id, model: modelId, secrets: { apiKey: name } });
  }

  await made.setup.setDefaultProfile(AZURE);

  return made;
}

/** Every file a start must leave alone: the config and each profile's own file, byte for byte. */
async function sharedFiles() {
  const files = [
    path.join(sheavly(), 'config.json'),
    ...(await readdir(path.join(sheavly(), 'profiles'))).map((id) =>
      path.join(sheavly(), 'profiles', id, 'profile.json'),
    ),
  ];

  return Object.fromEntries(
    await Promise.all(files.map(async (file) => [file, await readFile(file, 'utf8')] as const)),
  );
}

describe('starts on two profiles at the same moment', () => {
  it('runs each on its own profile, files it under that profile, and writes no shared file', async () => {
    const made = await twoProfiles();
    const before = await sharedFiles();
    const [first, second] = await Promise.all([
      made.client.call('startConversation', { body: { profile: AZURE } }),
      made.client.call('startConversation', { body: { profile: BEDROCK } }),
    ]);
    const [onAzure, onBedrock] = await Promise.all([
      made.client.call('getConversation', { id: first.id }),
      made.client.call('getConversation', { id: second.id }),
    ]);

    expect(onAzure.profile).toBe(AZURE);
    expect(onBedrock.profile).toBe(BEDROCK);
    expect(onAzure.model.id).toBe(AZURE_MODEL);
    expect(onBedrock.model.id).toBe(BEDROCK_MODEL);

    await Promise.all([
      made.client.send('closeConversation', { id: first.id }),
      made.client.send('closeConversation', { id: second.id }),
    ]);

    expect(await sharedFiles()).toEqual(before);

    const stored = await made.client.call('queryStoredConversations', { body: {} });

    expect(stored.conversations.map(({ id, profile }) => [id, profile]).sort()).toEqual(
      [
        [first.id, AZURE],
        [second.id, BEDROCK],
      ].sort(),
    );
  });
});
