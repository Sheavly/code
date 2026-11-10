import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { ProfileRegistry } from '@sheavly/storage/profile-registry/profile-registry.service';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import { REQUEST } from '../../harness/harness.constants.js';
import { ProfileSetup } from '../setup.service.js';

const profileId = profileIdSchema.parse('00000000-0000-4000-8000-000000000001');
const legacyId = modelIdSchema.parse('00000000-0000-4000-8000-000000000002');
const newId = modelIdSchema.parse('00000000-0000-4000-8000-000000000003');
let home = '';

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'cache-compatibility-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it.each([
  { adapter: 'openai', definition: { model: 'gpt-5' } },
  {
    adapter: 'azure-openai',
    definition: { deployment: 'arbitrary-legacy', baseUrl: 'https://azure.test/openai/v1' },
  },
])(
  'preserves legacy $adapter settings while new setup defaults on',
  async ({ adapter, definition }) => {
    const registry = new ProfileRegistry({ root: home });
    const { fetch, requests } = fakeFetch([]);
    const setup = new ProfileSetup({
      registry,
      adapters: createDefaultRegistry({ fetch }),
      home,
      request: REQUEST,
      remoteSetupAllowed: true,
    });

    await registry.put({ id: profileId, name: 'Test profile' });
    const open = await registry.open(profileId);
    const legacy = { name: 'Legacy model', adapter, definition };

    await open.putModel({ id: legacyId, ...legacy });
    await open.putSecrets({ id: legacyId, secrets: { apiKey: 'fake-key' } });
    await setup.checkCredential({ profile: profileId, model: legacyId });

    expect(requests.at(-1)?.body).not.toHaveProperty('prompt_cache_options');
    expect(
      (await setup.model({ profile: profileId, model: legacyId })).definition.explicitCache,
    ).toBe(false);
    expect((await open.getModel(legacyId))?.definition).toEqual(definition);

    await setup.putModel({
      profile: profileId,
      id: newId,
      model: { ...legacy, name: 'New model' },
    });
    await open.putSecrets({ id: newId, secrets: { apiKey: 'fake-key' } });
    expect((await open.getModel(newId))?.definition.explicitCache).toBe(true);
    await setup.checkCredential({ profile: profileId, model: newId });
    expect(requests.at(-1)?.body.prompt_cache_options).toEqual({ mode: 'explicit' });

    await setup.putModel({
      profile: profileId,
      id: legacyId,
      model: { ...legacy, name: 'Renamed' },
    });
    expect((await open.getModel(legacyId))?.definition.explicitCache).toBe(false);

    for (const explicitCache of [true, false]) {
      await setup.putModel({
        profile: profileId,
        id: legacyId,
        model: { ...legacy, definition: { ...definition, explicitCache } },
      });
      await setup.checkCredential({ profile: profileId, model: legacyId });
      expect((await open.getModel(legacyId))?.definition.explicitCache).toBe(explicitCache);

      if (explicitCache) {
        expect(requests.at(-1)?.body.prompt_cache_options).toEqual({ mode: 'explicit' });
      } else {
        expect(requests.at(-1)?.body).not.toHaveProperty('prompt_cache_options');
      }
    }
  },
);
