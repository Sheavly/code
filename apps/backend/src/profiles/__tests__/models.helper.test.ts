import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Model } from '@sheavly/protocol/model/model.types';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { ProfileRegistry } from '@sheavly/storage/profile-registry/profile-registry.service';
import { collect, fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import { REQUEST } from '../../harness/harness.constants.js';
import { modelsOf } from '../models.helper.js';

const PROFILE = profileIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
const ASTRA = modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a31');
const BORA = modelIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b72');
const CORA = modelIdSchema.parse('c1e8a3d4-7b25-4e69-8f10-2a6d9b4c7e53');
/** A key no other string could be: finding it in a note means it leaked. */
const KEY = 'sk-LEAK-CHECK-7e3f1a90';

const azure = {
  id: ASTRA,
  name: 'Astra',
  adapter: 'azure-openai',
  definition: { baseUrl: 'https://acme.openai.azure.com/openai/v1', deployment: 'gpt-5' },
};
const openai = { id: BORA, name: 'Bora', adapter: 'openai', definition: { model: 'gpt-6' } };

let root = '';
const registry = createDefaultRegistry();

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'backend-models-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** An open profile holding `models`, each with the key `KEY` unless it is listed in `keyless`. */
async function profileWith(params: { models: Model[]; keyless?: string[] }) {
  const profiles = new ProfileRegistry({ root });

  await profiles.put({ id: PROFILE, name: 'Work' });

  const profile = await profiles.open(PROFILE);

  for (const model of params.models) {
    await profile.putModel(model);

    if (!params.keyless?.includes(model.id)) {
      await profile.putSecrets({ id: model.id, secrets: { apiKey: KEY } });
    }
  }

  return { profile, profiles };
}

const build = (
  profile: Awaited<ReturnType<typeof profileWith>>['profile'],
  startWith?: typeof ASTRA,
) => modelsOf({ profile, registry, request: REQUEST, ...(startWith && { startWith }) });

describe('modelsOf', () => {
  it('builds each model of a profile with its own key, keyed by id and labelled by name', async () => {
    const { profile } = await profileWith({ models: [azure, openai] });
    const { models, notes } = await build(profile);

    expect(notes).toEqual([]);
    expect(models.choices).toEqual([
      { id: ASTRA, name: 'Astra', adapter: 'azure-openai', model: 'gpt-5' },
      { id: BORA, name: 'Bora', adapter: 'openai', model: 'gpt-6' },
    ]);
    expect(models.switch.names().sort()).toEqual([ASTRA, BORA].sort());
  });

  it.each([undefined, true, false])(
    'respects explicitCache=%s for saved OpenAI and Azure definitions',
    async (explicitCache) => {
      const stored = [azure, openai].map((model) => ({
        ...model,
        definition: {
          ...model.definition,
          ...(explicitCache !== undefined && { explicitCache }),
        },
      }));
      const { profile } = await profileWith({ models: stored });
      const { fetch, requests } = fakeFetch([]);
      const { models } = await modelsOf({
        profile,
        registry: createDefaultRegistry({ fetch }),
        request: REQUEST,
      });

      for (const model of stored) {
        models.switch.use(model.id);
        await collect(
          models.switch.stream({
            messages: [{ role: 'user', content: 'Legacy prompt' }],
            tools: [],
            signal: new AbortController().signal,
          }),
        );
        expect((await profile.getModel(model.id))?.definition).toEqual(model.definition);
      }

      for (const request of requests) {
        if (explicitCache === true) {
          expect(request.body.prompt_cache_options).toEqual({ mode: 'explicit' });
        } else {
          expect(request.body).not.toHaveProperty('prompt_cache_options');
          expect(JSON.stringify(request.body.input)).not.toContain('prompt_cache_breakpoint');
        }
      }
    },
  );

  it('starts on the first model, or on the profile’s last one when it is among them', async () => {
    const { profile } = await profileWith({ models: [azure, openai] });

    expect((await build(profile)).models.switch.active).toBe(ASTRA);
    expect((await build(profile, BORA)).models.switch.active).toBe(BORA);
    // A last model that was removed since is only a hint: it starts on the first.
    expect((await build(profile, CORA)).models.switch.active).toBe(ASTRA);
  });

  it('tells the agent each model’s own window, 300K unless its file sets one, as the switch moves', async () => {
    const { profile } = await profileWith({
      models: [azure, { ...openai, contextWindow: 1_000_000 }],
    });
    const { models } = await build(profile);

    expect(models.switch.contextWindow).toBe(300_000);
    models.switch.use(BORA);
    expect(models.switch.contextWindow).toBe(1_000_000);
  });

  it('leaves out a model with no key, with a note that names it, and keeps the rest', async () => {
    const { profile } = await profileWith({ models: [azure, openai], keyless: [ASTRA] });
    const { models, notes } = await build(profile);

    expect(models.choices.map((choice) => choice.id)).toEqual([BORA]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Astra');
    expect(models.switch.active).toBe(BORA);
  });

  it('never puts a key in a note, nor anything an adapter said', async () => {
    const { profile } = await profileWith({ models: [azure, openai], keyless: [BORA] });
    const bad = {
      ...azure,
      id: CORA,
      name: 'Cora',
      definition: { baseUrl: 'not a url', deployment: '' },
    };

    await profile.putModel(bad);
    await profile.putSecrets({ id: CORA, secrets: { apiKey: KEY } });

    const { notes } = await build(profile);

    expect(notes).toHaveLength(2);
    expect(notes.join('\n')).not.toContain(KEY);
    expect(notes.join('\n')).not.toContain('not a url');
  });

  it('has no models, and no active provider, for a profile with none', async () => {
    const { profile } = await profileWith({ models: [] });
    const { models } = await build(profile);

    expect(models.choices).toEqual([]);
    expect(models.switch.active).toBeUndefined();
  });

  it('reports a model file it cannot read as a note, and still builds the others', async () => {
    const { profile } = await profileWith({ models: [azure, openai] });

    await rm(path.join(root, 'profiles', PROFILE, 'models', `${BORA}.json`));
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(path.join(root, 'profiles', PROFILE, 'models', `${BORA}.json`), '{ nope'),
    );

    const { models, notes } = await build(profile);

    expect(models.choices.map((choice) => choice.id)).toEqual([ASTRA]);
    expect(notes).toHaveLength(1);
  });

  it('sends each model’s own key to its own endpoint, and switching changes which', async () => {
    const { profile } = await profileWith({ models: [azure, openai], keyless: [ASTRA, BORA] });
    const OTHER_KEY = 'sk-OTHER-3b7d90';
    const { fetch, requests } = fakeFetch([]);
    const { models } = await modelsOf({
      profile: await withKeys({ profile, keys: { [ASTRA]: KEY, [BORA]: OTHER_KEY } }),
      registry: createDefaultRegistry({ fetch }),
      request: REQUEST,
    });
    const say = () =>
      collect(
        models.switch.stream({
          messages: [{ role: 'user', content: 'hi' }],
          tools: [],
          signal: new AbortController().signal,
        }),
      );

    await say();
    models.switch.use(BORA);
    await say();

    expect(requests.map((request) => new URL(request.url).host)).toEqual([
      'acme.openai.azure.com',
      'api.openai.com',
    ]);
    // The key travels in a header, and each model's goes only to its own endpoint.
    expect(JSON.stringify(requests[0]?.headers)).toContain(KEY);
    expect(JSON.stringify(requests[0]?.headers)).not.toContain(OTHER_KEY);
    expect(JSON.stringify(requests[1]?.headers)).toContain(OTHER_KEY);
    expect(JSON.stringify(requests[1]?.headers)).not.toContain(KEY);
  });
});

/** Sets each model's key in `profile`, and hands the profile back. */
async function withKeys(params: {
  profile: Awaited<ReturnType<typeof profileWith>>['profile'];
  keys: Record<string, string>;
}) {
  for (const [id, apiKey] of Object.entries(params.keys)) {
    await params.profile.putSecrets({ id: modelIdSchema.parse(id), secrets: { apiKey } });
  }

  return params.profile;
}
