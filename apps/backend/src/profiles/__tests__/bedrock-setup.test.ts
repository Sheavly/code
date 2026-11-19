import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { useTempFolders } from '@sheavly/testing/files/temp-folders.fake';
import { testBackend } from '../../testing/backend.fake.js';

const PROFILE = profileIdSchema.parse('7c3a1e90-5b2d-4f68-a9d4-1e8b6c0f3a52');
const MODEL = modelIdSchema.parse('7c3a1e90-5b2d-4f68-a9d4-1e8b6c0f3a53');
const KEY = 'bk-LEAK-CHECK-2b6f90d3';

const folders = useTempFolders({ prefix: 'bedrock-setup-', names: ['app'] });
const sheavly = () => path.join(folders.base, 'sheavly');

/** A backend whose network refuses every call, echoing the key as a provider might. */
function backend() {
  const calls: { url: string; key: string | null }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);

    const bearer = request.headers.get('authorization')?.replace(/^Bearer /, '');

    calls.push({ url: request.url, key: request.headers.get('x-api-key') ?? bearer ?? null });

    return new Response(`denied ${KEY}`, { status: 403 });
  }) as typeof globalThis.fetch;

  return { calls, made: testBackend({ home: sheavly(), workspace: folders.app, fetch }) };
}

/** Every file under `folder`, by its path inside it. */
const readFiles = async (folder: string): Promise<Record<string, string>> => {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const file = path.join(entry.parentPath, entry.name);

        return [path.relative(folder, file), await readFile(file, 'utf8')] as const;
      }),
  );

  return Object.fromEntries(files);
};

describe('setting up a model on Bedrock', () => {
  const claude = { model: 'eu.anthropic.claude-sonnet-5-5', maxTokens: 1024 };
  const gpt = { model: 'eu.openai.gpt-6-astra' };
  const keyPair = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: KEY };
  const sonnet = { model: 'claude-sonnet-5-5', family: 'claude' };
  const astra = { model: 'gpt-6-astra', family: 'gpt' };
  const messages = 'https://bedrock-runtime.eu-west-1.amazonaws.com/anthropic/v1/messages';
  const responses = 'https://bedrock-runtime.eu-west-1.amazonaws.com/openai/v1/responses';
  const signed = expect.stringMatching(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//) as string;

  it.each([
    { adapter: 'bedrock-anthropic', identity: sonnet, fields: { auth: 'api-key', ...claude } },
    { adapter: 'bedrock-openai', identity: astra, fields: { auth: 'api-key', ...gpt } },
    { adapter: 'bedrock-anthropic', identity: sonnet, fields: { auth: 'access-key', ...claude } },
    { adapter: 'bedrock-openai', identity: astra, fields: { auth: 'access-key', ...gpt } },
  ])(
    'keeps the secrets of $adapter with $fields.auth in the credential store only, out of the model file and out of a check’s result',
    async ({ adapter, identity, fields }) => {
      const byKey = fields.auth === 'api-key';
      const secrets = byKey ? { apiKey: KEY } : keyPair;
      const url = adapter === 'bedrock-anthropic' ? messages : responses;
      const sent = byKey ? KEY : signed;
      const { calls, made } = backend();

      await made.setup.putProfile({ id: PROFILE, name: 'Bedrock' });
      await made.setup.putModel({
        profile: PROFILE,
        id: MODEL,
        model: {
          name: 'Bedrock model',
          adapter,
          identity,
          definition: { region: 'eu-west-1', ...fields },
        },
      });
      await made.setup.putCredential({ profile: PROFILE, model: MODEL, secrets });

      const result = await made.setup.checkCredential({ profile: PROFILE, model: MODEL });
      const files = await readFiles(path.join(sheavly(), 'profiles', PROFILE));
      const holding = Object.entries(files).filter(([, text]) => text.includes(KEY));

      // The secret is stored once, in the credential file, and never in the model's own file.
      expect(holding).toHaveLength(1);
      expect(holding[0]?.[0]).not.toContain('models');
      expect(files[`models/${MODEL}.json`]).toContain(fields.model);
      expect(JSON.stringify(result)).not.toContain(KEY);
      expect(result).toMatchObject({ status: 'invalid' });
      // The one call went to the Region the model names: an API key is sent as it is, an access
      // key pair only as a signature, never the secret itself.
      expect(calls).toEqual([{ url, key: sent }]);
    },
  );

  it.each([
    [
      'a model whose profile is not its own',
      {
        name: 'Opus',
        adapter: 'bedrock-anthropic',
        identity: { model: 'claude-opus-5-5', family: 'claude' },
        definition: {
          auth: 'api-key',
          region: 'us-east-1',
          model: 'us.anthropic.claude-sonnet-5-5',
          maxTokens: 1,
        },
      },
      'Use an inference profile for claude-opus-5-5',
    ],
    [
      'a Region that is not a Region code, so the host cannot be steered',
      {
        name: 'x',
        adapter: 'bedrock-openai',
        definition: {
          auth: 'api-key',
          region: 'evil.example.com/',
          model: 'us.openai.gpt-6-astra',
        },
      },
      'Region',
    ],
    [
      'credentials that are not chosen',
      {
        name: 'x',
        adapter: 'bedrock-openai',
        definition: { region: 'us-east-1', model: 'us.openai.gpt-6-astra' },
      },
      'auth',
    ],
  ])('refuses %s, before anything is stored', async (_name, model, why) => {
    const { made } = backend();

    await made.setup.putProfile({ id: PROFILE, name: 'Bedrock' });
    await expect(made.setup.putModel({ profile: PROFILE, id: MODEL, model })).rejects.toMatchObject(
      { reason: 'invalid', message: expect.stringContaining(why) as string },
    );

    const files = await readFiles(path.join(sheavly(), 'profiles', PROFILE));

    expect(Object.keys(files).filter((name) => name.startsWith('models'))).toEqual([]);
  });
});
