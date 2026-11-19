import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModelEffort } from '@sheavly/protocol/model/model.types';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { ProfileRegistry } from '@sheavly/storage/profile-registry/profile-registry.service';
import { collect, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { REQUEST } from '../../harness/harness.constants.js';
import { modelsOf } from '../models.helper.js';
import { ProfileSetup } from '../setup.service.js';

const profileId = profileIdSchema.parse('00000000-0000-4000-8000-000000000001');
const snapshotId = modelIdSchema.parse('00000000-0000-4000-8000-000000000002');
const legacyId = modelIdSchema.parse('00000000-0000-4000-8000-000000000003');
const endpoint = 'https://resource.test/models/chat/completions?api-version=2024-05-01-preview';
let home = '';

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'deepseek-snapshot-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function setupFor(fetch: typeof globalThis.fetch) {
  const adapters = createDefaultRegistry({ fetch });
  const registry = new ProfileRegistry({ root: home });
  const setup = new ProfileSetup({
    registry,
    adapters,
    home,
    request: REQUEST,
    remoteSetupAllowed: true,
  });

  return { adapters, registry, setup };
}

const efforts: { effort: ModelEffort; reasoningEffort: string }[] = [
  { effort: 'low', reasoningEffort: 'low' },
  { effort: 'medium', reasoningEffort: 'high' },
  { effort: 'high', reasoningEffort: 'high' },
  { effort: 'extreme', reasoningEffort: 'max' },
];

describe.each(['DeepSeek-V4.1-Flash-1017', 'production-east'])(
  'snapshot deployment %s',
  (deployment) => {
    it.each(efforts)(
      'keeps setup thinking/replay and $effort effort through provider construction',
      async ({ effort, reasoningEffort }) => {
        const fake = fakeFetchSequence({
          responses: [
            [
              {
                choices: [
                  {
                    index: 0,
                    delta: { reasoning_content: 'considered', content: 'ok' },
                    finish_reason: 'stop',
                  },
                ],
              },
            ],
            [{ choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }] }],
          ],
          complete: false,
        });
        const { adapters, registry, setup } = setupFor(fake.fetch);

        await setup.putProfile({ id: profileId, name: 'Offline test' });
        const snapshot = setup
          .modelCatalog()
          .find(({ identity }) => identity.model === 'DeepSeek-V4.1-Flash-1017');
        const host = snapshot?.hosts[0];

        if (!snapshot || !host) throw new Error('Missing snapshot catalogue preset');
        const definition = { baseUrl: endpoint, ...host.defaults, ...host.fixed, deployment };

        await setup.putModel({
          profile: profileId,
          id: snapshotId,
          model: {
            name: snapshot.name,
            identity: snapshot.identity,
            adapter: host.adapter,
            definition,
          },
        });
        await setup.putCredential({
          profile: profileId,
          model: snapshotId,
          secrets: { apiKey: 'fake-key' },
        });
        expect((await setup.model({ profile: profileId, model: snapshotId })).definition).toEqual(
          definition,
        );
        const profile = await registry.open(profileId);
        const { models, notes } = await modelsOf({
          profile,
          registry: adapters,
          request: REQUEST,
          efforts: { [snapshotId]: effort },
        });

        expect(notes).toEqual([]);
        expect(models.choices).toEqual([
          { id: snapshotId, name: snapshot.name, adapter: 'azure-chat', model: deployment },
        ]);
        const provider = models.switch.pinned(snapshotId);
        const events = await collect(
          provider.stream({
            messages: [{ role: 'user', content: 'hello' }],
            tools: [],
            signal: new AbortController().signal,
          }),
        );
        const reasoning = events.find((event) => event.type === 'reasoning');

        expect(reasoning).toEqual({
          type: 'reasoning',
          item: {
            source: `chat:${endpoint}#${deployment}`,
            data: { type: 'chat-reasoning', content: 'considered' },
          },
        });
        if (reasoning?.type !== 'reasoning') throw new Error('Missing fake reasoning');
        await collect(
          provider.stream({
            messages: [
              { role: 'assistant', content: 'ok', toolCalls: [], reasoning: [reasoning.item] },
              { role: 'user', content: 'continue' },
            ],
            tools: [],
            signal: new AbortController().signal,
          }),
        );

        for (const request of fake.requests) {
          expect(request.url).toBe(endpoint);
          expect(request.body).toMatchObject({
            model: deployment,
            thinking: { type: 'enabled' },
            reasoning_effort: reasoningEffort,
          });
          expect(request.body).not.toHaveProperty('effortProfile');
          expect(request.body).not.toHaveProperty('replayReasoning');
        }

        expect(fake.requests[1]?.body.messages).toEqual([
          { role: 'assistant', content: 'ok', reasoning_content: 'considered' },
          { role: 'user', content: 'continue' },
        ]);
        expect((await profile.getModel(snapshotId))?.definition).toEqual(definition);
      },
    );
  },
);

it('does not migrate saved V4 Flash settings when listing the catalogue or building providers', async () => {
  const fake = fakeFetchSequence({
    responses: [[{ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }]],
    complete: false,
  });
  const { adapters, registry, setup } = setupFor(fake.fetch);

  await setup.putProfile({ id: profileId, name: 'Offline test' });
  const profile = await registry.open(profileId);
  const definition = { baseUrl: endpoint, deployment: 'legacy-custom', replayReasoning: true };

  await profile.putModel({
    id: legacyId,
    name: 'Saved V4 Flash',
    adapter: 'azure-chat',
    identity: { model: 'deepseek-v4-flash', family: 'deepseek' },
    definition,
  });
  await profile.putSecrets({ id: legacyId, secrets: { apiKey: 'fake-key' } });
  expect(
    setup.modelCatalog().filter(({ identity }) => identity.family === 'deepseek'),
  ).toHaveLength(2);
  const { models, notes } = await modelsOf({
    profile,
    registry: adapters,
    request: REQUEST,
    efforts: { [legacyId]: 'extreme' },
  });

  expect(notes).toEqual([]);
  await collect(
    models.switch.stream({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      signal: new AbortController().signal,
    }),
  );
  expect(fake.requests[0]?.body.reasoning_effort).toBe('xhigh');
  expect(fake.requests[0]?.body).not.toHaveProperty('thinking');
  expect((await profile.getModel(legacyId))?.definition).toEqual(definition);
});
