import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Conversations } from '@sheavly/host/conversations/conversations.service';
import type { Model } from '@sheavly/protocol/model/model.types';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { collect, fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import { trustStoreFor } from '../../profiles/home.helper.js';
import { Profiles } from '../../profiles/profiles.service.js';
import { setUpProfile, TEST_PROFILE } from '../../profiles/testing/profiles.fake.js';
import { servedConversation } from '../served.helper.js';
import { parseCliSettings, parseRunEnv } from '../settings.validator.js';

const FAST_ID = modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a31');
const DEEP_ID = modelIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b72');
const OTHER_ID = modelIdSchema.parse('c1e8a3d4-7b25-4e69-8f10-2a6d9b4c7e53');
const fast: Model = {
  id: FAST_ID,
  name: 'Fast',
  adapter: 'openai',
  definition: { model: 'gpt-fast' },
};
const deep: Model = {
  id: DEEP_ID,
  name: 'Deep',
  adapter: 'openai',
  definition: { model: 'gpt-deep' },
};

let base: string;
let home: string;
let root: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'served-conversation-'));
  home = path.join(base, 'sheavly');
  root = path.join(base, 'project');
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** A backend's conversations (its workspace the temp project, its folder the temp `home`), as `serve.ts` makes them. */
function serve(extra: Record<string, string> = {}, fetch?: typeof globalThis.fetch) {
  const env = { ...extra, SHEAVLY_HOME: home, WORKSPACE_ROOT: root };
  const settings = { ...parseCliSettings({ env, args: [] }), ...parseRunEnv(env) };
  const profiles = new Profiles({
    env,
    ...(fetch && { adapters: createDefaultRegistry({ fetch }) }),
  });
  const trustStore = trustStoreFor(env);
  const logged: string[] = [];

  return {
    logged,
    conversations: new Conversations({
      create: ({ messages }) =>
        servedConversation({
          env,
          profiles,
          trustStore,
          settings,
          messages,
          log: (text) => logged.push(text),
        }),
    }),
  };
}

describe('servedConversation', () => {
  it('reports its run: the workspace, the profile’s models, trust and the allow list', async () => {
    await setUpProfile({ home, models: [fast, deep] });

    const { conversations } = serve();
    const id = await conversations.start();

    // The profile lists its models by name, and a new profile's first is where it starts.
    expect(conversations.details(id)).toMatchObject({
      workspace: expect.stringContaining('project') as string,
      model: { id: DEEP_ID, name: 'Deep', adapter: 'openai', model: 'gpt-deep' },
      models: [
        { id: DEEP_ID, name: 'Deep' },
        { id: FAST_ID, name: 'Fast' },
      ],
      projectTrust: 'no_hooks',
      skipAllowList: false,
    });
    await conversations.closeAll();
  });

  it('switches each conversation’s model on its own, by id, among the profile’s models', async () => {
    await setUpProfile({ home, models: [fast, deep] });

    const { conversations } = serve();
    const a = await conversations.start();
    const b = await conversations.start();

    conversations.useModel({ id: a, modelId: FAST_ID });

    expect(conversations.details(a).model).toMatchObject({ id: FAST_ID, name: 'Fast' });
    expect(conversations.details(b).model).toMatchObject({ id: DEEP_ID, name: 'Deep' });
    // A model the profile does not have is refused, by its id.
    expect(() => conversations.useModel({ id: a, modelId: OTHER_ID })).toThrow(OTHER_ID);
    await conversations.closeAll();
  });

  it('starts on the model the profile last used, and remembers each switch for the next conversation', async () => {
    const registry = await setUpProfile({ home, models: [fast, deep], lastModelId: FAST_ID });
    const { conversations } = serve();
    const first = await conversations.start();

    // Fast is not first by name: it is where this one starts because the profile last used it.
    expect(conversations.details(first).model.id).toBe(FAST_ID);

    conversations.useModel({ id: first, modelId: DEEP_ID });

    // Remembered after the switch, not before it: wait for the write rather than assume it.
    for (let tries = 0; tries < 200; tries += 1) {
      if ((await registry.get(TEST_PROFILE))?.lastModelId === DEEP_ID) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const second = await conversations.start();

    expect(conversations.details(second).model.id).toBe(DEEP_ID);
    // The conversation that switched is not moved by anyone else's choice.
    expect(conversations.details(first).model.id).toBe(DEEP_ID);
    await conversations.closeAll();
  });

  it('is refused with not_set_up when there is no profile, saying what to do', async () => {
    const { conversations } = serve();

    await expect(conversations.start()).rejects.toMatchObject({
      name: 'ConversationsError',
      reason: 'not_set_up',
      message: expect.stringContaining('create a profile') as string,
    });
  });

  it('is refused with not_set_up when the profile has no model it can use, naming what was left out', async () => {
    await setUpProfile({ home, models: [fast], keyless: [FAST_ID] });

    const { conversations } = serve();
    const refusal = await conversations.start().catch((caughtError: unknown) => caughtError);

    expect(refusal).toMatchObject({ reason: 'not_set_up' });
    expect((refusal as Error).message).toContain('no model that can be used');
    expect((refusal as Error).message).toContain('Fast');
  });

  it('serves the models it can and tells the log about the one it left out', async () => {
    await setUpProfile({ home, models: [fast, deep], keyless: [DEEP_ID] });

    const { conversations, logged } = serve();
    const id = await conversations.start();

    expect(conversations.details(id).models.map(({ id: each }) => each)).toEqual([FAST_ID]);
    expect(logged.join('')).toContain('Deep');
    expect(logged.join('')).not.toContain('sk-test');
    await conversations.closeAll();
  });

  it('appends each model call to MODEL_CALLS_FILE, and prints it with SHOW_MODEL_CALLS', async () => {
    await setUpProfile({ home, models: [fast] });

    const file = path.join(base, 'model-calls.jsonl');
    const { fetch } = fakeFetch([{ type: 'response.output_text.delta', delta: 'hi' }]);
    const { conversations, logged } = serve(
      { MODEL_CALLS_FILE: file, SHOW_MODEL_CALLS: 'true' },
      fetch,
    );
    const id = await conversations.start();

    await collect((await conversations.send({ id, prompt: { text: 'hello' } })).events);

    const [call] = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as { at: number; messages: { content: string }[]; tools: string[] },
      );

    expect(call?.messages.at(-1)?.content).toBe('hello');
    expect(Number.isInteger(call?.at)).toBe(true);
    expect(call?.tools).toContain('read_file');
    expect(logged.join('')).toContain('model call for "hello"');
    await conversations.closeAll();
  });

  it('says which skills didn’t load when it opens a conversation', async () => {
    await setUpProfile({ home, models: [fast] });
    await mkdir(path.join(root, '.agents', 'skills', 'broken'), { recursive: true });
    await writeFile(path.join(root, '.agents', 'skills', 'broken', 'SKILL.md'), 'no frontmatter\n');

    const { conversations, logged } = serve();

    await conversations.start();
    expect(logged.join('')).toContain('skill not loaded');
    await conversations.closeAll();
  });
});
