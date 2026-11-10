import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Model } from '@sheavly/protocol/model/model.types';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { collect, fakeFetch, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { setUpProfile, TEST_PROFILE } from '../../profiles/testing/profiles.fake.js';
import { testBackend } from '../../testing/backend.fake.js';

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
  const { conversations, logged } = testBackend({
    home,
    workspace: root,
    env: extra,
    ...(fetch && { fetch }),
  });

  return { logged, conversations };
}

describe('servedConversation', () => {
  it('reports its run: the workspace, the profile’s models, trust and the permission mode', async () => {
    await setUpProfile({ home, models: [fast, deep] });

    const { conversations } = serve();
    const id = await conversations.start();

    // The profile lists its models by name, and a new profile's first is where it starts.
    expect(await conversations.details(id)).toMatchObject({
      workspace: expect.stringContaining('project') as string,
      model: { id: DEEP_ID, name: 'Deep', adapter: 'openai', model: 'gpt-deep' },
      models: [
        { id: DEEP_ID, name: 'Deep' },
        { id: FAST_ID, name: 'Fast' },
      ],
      projectTrust: 'no_hooks',
      permissionMode: 'ask',
    });
    await conversations.closeAll();
  });

  it('switches each conversation’s model on its own, by id, among the profile’s models', async () => {
    await setUpProfile({ home, models: [fast, deep] });

    const { conversations } = serve();
    const a = await conversations.start();
    const b = await conversations.start();

    await conversations.useModel({ id: a, modelId: FAST_ID });

    expect((await conversations.details(a)).model).toMatchObject({ id: FAST_ID, name: 'Fast' });
    expect((await conversations.details(b)).model).toMatchObject({ id: DEEP_ID, name: 'Deep' });
    // A model the profile does not have is refused, by its id.
    await expect(conversations.useModel({ id: a, modelId: OTHER_ID })).rejects.toThrow(OTHER_ID);
    await conversations.closeAll();
  });

  it('starts on the model the profile last used, and remembers each switch for the next conversation', async () => {
    const registry = await setUpProfile({ home, models: [fast, deep], lastModelId: FAST_ID });
    const { conversations } = serve();
    const first = await conversations.start();

    // Fast is not first by name: it is where this one starts because the profile last used it.
    expect((await conversations.details(first)).model.id).toBe(FAST_ID);

    await conversations.useModel({ id: first, modelId: DEEP_ID });

    // Remembered after the switch, not before it: wait for the write rather than assume it.
    for (let tries = 0; tries < 200; tries += 1) {
      if ((await registry.get(TEST_PROFILE))?.lastModelSelection?.modelId === DEEP_ID) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const second = await conversations.start();

    expect((await conversations.details(second)).model.id).toBe(DEEP_ID);
    // The conversation that switched is not moved by anyone else's choice.
    expect((await conversations.details(first)).model.id).toBe(DEEP_ID);
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

  it('remembers effort per model, starts new conversations on the last selection, and restores an older conversation', async () => {
    await setUpProfile({ home, models: [fast, deep], lastModelId: FAST_ID });
    const { fetch, requests } = fakeFetch([{ type: 'response.output_text.delta', delta: 'OK' }]);
    const { conversations } = serve({}, fetch);
    const a = await conversations.start();
    const b = await conversations.start();

    await conversations.useModel({ id: a, modelId: FAST_ID, mode: 'high' });
    await conversations.useModel({ id: a, modelId: DEEP_ID, mode: 'low' });
    await conversations.useModel({ id: a, modelId: FAST_ID });
    expect((await conversations.details(a)).model.mode).toBe('high');
    expect((await conversations.details(b)).model.mode).toBe('medium');

    await collect((await conversations.send({ id: a, prompt: { text: 'hi' } })).events);
    expect(requests[0]?.body.reasoning).toEqual({ effort: 'high' });
    await conversations.close(a);
    await conversations.useModel({ id: b, modelId: DEEP_ID, mode: 'extreme' });
    await conversations.closeAll();

    const restarted = serve({}, fetch).conversations;
    const fresh = await restarted.start();

    expect((await restarted.details(fresh)).model).toMatchObject({ id: DEEP_ID, mode: 'extreme' });
    await restarted.reopen(a);
    expect((await restarted.details(a)).model).toMatchObject({ id: FAST_ID, mode: 'high' });
    await restarted.useModel({ id: a, modelId: DEEP_ID });
    expect((await restarted.details(a)).model.mode).toBe('extreme');
    await restarted.closeAll();
  });

  it('serializes simultaneous model and effort selections without losing the model’s remembered mode', async () => {
    await setUpProfile({ home, models: [fast, deep] });
    const { conversations } = serve();
    const id = await conversations.start();

    await Promise.all([
      conversations.useModel({ id, modelId: FAST_ID, mode: 'high' }),
      conversations.useModel({ id, modelId: DEEP_ID, mode: 'low' }),
      conversations.useModel({ id, modelId: FAST_ID }),
    ]);
    expect((await conversations.details(id)).model).toMatchObject({ id: FAST_ID, mode: 'high' });
    await conversations.closeAll();
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

    expect((await conversations.details(id)).models.map(({ id: each }) => each)).toEqual([FAST_ID]);
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

    expect(call?.messages[0]?.content).toBe('hello');
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

const say = (text: string) => [{ type: 'response.output_text.delta', delta: text }];

/** What each model call was sent, as one string to look for a message in. */
const sentTexts = (requests: { body: Record<string, unknown> }[]) =>
  JSON.stringify(requests.map((request) => request.body.input));

describe('a conversation the backend keeps', () => {
  it('is listed after a restart, and was closed cleanly', async () => {
    await setUpProfile({ home, models: [fast] });

    const { fetch } = fakeFetchSequence({ responses: [say('hello')] });
    const first = serve({}, fetch).conversations;
    const id = await first.start();

    await collect((await first.send({ id, prompt: { text: 'hi there' } })).events);
    await first.closeAll();

    const restarted = serve({}, fetch).conversations;
    const [stored] = await restarted.listStored();

    expect(stored).toMatchObject({ id, modelId: FAST_ID });
    expect(stored?.status).not.toBe('interrupted');
    await restarted.closeAll();
  });

  it('is reopened under its own id and continues from its history', async () => {
    await setUpProfile({ home, models: [fast] });

    const before = serve({}, fakeFetchSequence({ responses: [say('hello')] }).fetch).conversations;
    const id = await before.start();

    await collect((await before.send({ id, prompt: { text: 'my name is Ada' } })).events);
    await before.closeAll();

    const second = fakeFetchSequence({ responses: [say('Hello again, Ada')] });
    const after = serve({}, second.fetch).conversations;

    expect(await after.reopen(id)).toBe(id);
    await collect((await after.send({ id, prompt: { text: 'what is my name?' } })).events);

    // The model was sent the earlier exchange, so it can answer from it.
    expect(sentTexts(second.requests)).toContain('my name is Ada');
    const texts = after
      .messages(id)
      .flatMap((message) => ('content' in message ? [message.content] : []));

    // One for the project's instructions, one telling the agent about its scratch folder.
    expect(texts.filter((text) => text.startsWith('<instruction-context'))).toHaveLength(2);
    expect(texts.filter((text) => !text.startsWith('<instruction-context'))).toEqual([
      'my name is Ada',
      'hello',
      'what is my name?',
      'Hello again, Ada',
    ]);
    await after.closeAll();
  });

  it('is kept under the profile, in the workspace’s folder, in files a person can read', async () => {
    await setUpProfile({ home, models: [fast] });

    const { conversations } = serve({}, fakeFetchSequence({ responses: [say('hello')] }).fetch);
    const id = await conversations.start();

    await collect((await conversations.send({ id, prompt: { text: 'hi' } })).events);
    await conversations.closeAll();

    const found = await readdir(path.join(home, 'profiles'), { recursive: true });
    const kept = found.filter((name) => name.includes(`conversations${path.sep}${id}${path.sep}`));
    const history = kept.find((name) => name.endsWith('history.json')) ?? '';

    expect(kept.map((name) => path.basename(name))).toEqual(
      expect.arrayContaining(['history.json', 'index.json', 'stream.jsonl']),
    );
    expect(JSON.parse(await readFile(path.join(home, 'profiles', history), 'utf8'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'hi' })]),
    );
  });

  it('is not stored when there is no profile: the conversation is refused first', async () => {
    const { conversations } = serve({}, fakeFetchSequence({ responses: [] }).fetch);

    await expect(conversations.start()).rejects.toMatchObject({ reason: 'not_set_up' });
    expect(await conversations.listStored()).toEqual([]);
    await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps each conversation apart, and lists them all', async () => {
    await setUpProfile({ home, models: [fast] });

    const { fetch } = fakeFetchSequence({ responses: [say('one')] });
    const { conversations } = serve({}, fetch);
    const a = await conversations.start();
    const b = await conversations.start();

    await collect((await conversations.send({ id: a, prompt: { text: 'to a' } })).events);
    await collect((await conversations.send({ id: b, prompt: { text: 'to b' } })).events);
    await conversations.closeAll();

    const listed = await serve({}, fetch).conversations.listStored();

    expect(listed.map((conversation) => conversation.id).sort()).toEqual([a, b].sort());
  });
});
