import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Conversations } from '@sheavly/host/conversations/conversations.service';
import { collect, fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import { servedConversation } from '../served.helper.js';
import { parseCliSettings, parseRunEnv } from '../settings.validator.js';

const AZURE = (name: string) => ({
  [`${name}_ADAPTER`]: 'azure',
  [`${name}_API_KEY`]: 'k',
  [`${name}_BASE_URL`]: 'https://res.openai.azure.com/openai/v1',
  [`${name}_DEPLOYMENT`]: name.toLowerCase(),
});

let base: string;
let root: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'served-conversation-'));
  root = path.join(base, 'project');
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(base, { recursive: true, force: true });
});

/** A backend's conversations on `env` (its workspace the temp project), as `serve.ts` makes them. */
function serve(env: Record<string, string>) {
  const full = { ...env, WORKSPACE_ROOT: root, SHEAVLY_TRUST_FILE: path.join(base, 'trust.json') };
  const settings = {
    ...parseCliSettings({ env: full, args: [] }),
    ...parseRunEnv(full),
  };
  const logged: string[] = [];

  return {
    logged,
    conversations: new Conversations({
      create: ({ messages }) =>
        servedConversation({ env: full, settings, messages, log: (text) => logged.push(text) }),
    }),
  };
}

describe('servedConversation', () => {
  it('reports its run: the workspace, the one model, trust and the allow list', async () => {
    const { conversations } = serve({ OPENAI_API_KEY: 'sk-test', MODEL: 'gpt-x' });
    const id = await conversations.start();

    expect(conversations.details(id)).toMatchObject({
      workspace: expect.stringContaining('project') as string,
      model: { name: 'gpt-x', adapter: 'openai', model: 'gpt-x' },
      models: [],
      projectTrust: 'no_hooks',
      skipAllowList: false,
    });
    expect(() => conversations.useModel({ id, name: 'other' })).toThrow('No model other');
    await conversations.closeAll();
  });

  it('switches each conversation’s model on its own, among the ones MODELS lists', async () => {
    const env = { MODELS: 'fast, deep', ...AZURE('FAST'), ...AZURE('DEEP') };
    const { conversations } = serve(env);
    const a = await conversations.start();
    const b = await conversations.start();

    expect(conversations.details(a).models.map(({ name }) => name)).toEqual(['fast', 'deep']);
    conversations.useModel({ id: a, name: 'deep' });
    expect(conversations.details(a).model.name).toBe('deep');
    expect(conversations.details(b).model.name).toBe('fast');
    await conversations.closeAll();
  });

  it('appends each model call to MODEL_CALLS_FILE, and prints it with SHOW_MODEL_CALLS', async () => {
    const file = path.join(base, 'model-calls.jsonl');
    const { fetch } = fakeFetch([{ type: 'response.output_text.delta', delta: 'hi' }]);

    vi.stubGlobal('fetch', fetch);

    const { conversations, logged } = serve({
      OPENAI_API_KEY: 'sk-test',
      MODEL_CALLS_FILE: file,
      SHOW_MODEL_CALLS: 'true',
    });
    const id = await conversations.start();

    await collect((await conversations.send({ id, prompt: { text: 'hello' } })).events);

    const [call] = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            at: string;
            messages: { content: string }[];
            tools: string[];
          },
      );

    expect(call?.messages.at(-1)?.content).toBe('hello');
    expect(call?.tools).toContain('read_file');
    expect(logged.join('')).toContain('model call for "hello"');
    await conversations.closeAll();
  });

  it('says which skills didn’t load when it opens a conversation', async () => {
    await mkdir(path.join(root, '.agents', 'skills', 'broken'), { recursive: true });
    await writeFile(path.join(root, '.agents', 'skills', 'broken', 'SKILL.md'), 'no frontmatter\n');

    const { conversations, logged } = serve({ OPENAI_API_KEY: 'sk-test' });

    await conversations.start();
    expect(logged.join('')).toContain('skill not loaded');
    await conversations.closeAll();
  });
});
