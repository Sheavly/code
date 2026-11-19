import { describe, expect, it } from 'vitest';
import type { AdapterDescription } from '@sheavly/protocol/model/model.types';
import { setupAnswers } from '../../testing/setup.fake.js';
import { askSecrets } from '../form.helper.js';

const secret = (title: string, appliesWhen: Record<string, string>, extra: object = {}) => ({
  type: 'string',
  secret: true,
  title,
  appliesWhen,
  ...extra,
});

/** An adapter that signs in one of two ways, each with secrets of its own, as Bedrock's do. */
const adapter: AdapterDescription = {
  kind: 'two-ways',
  description: 'Signs in one of two ways',
  remoteField: 'model',
  secrets: ['apiKey', 'accessKeyId', 'secretAccessKey', 'sessionToken'],
  config: {
    type: 'object',
    required: ['auth', 'model'],
    properties: {
      auth: { type: 'string', enum: ['api-key', 'access-key'] },
      model: { type: 'string' },
      apiKey: secret('API key', { auth: 'api-key' }),
      accessKeyId: secret('Access key ID', { auth: 'access-key' }),
      secretAccessKey: secret('Secret access key', { auth: 'access-key' }),
      sessionToken: secret('Session token', { auth: 'access-key' }, { optional: true }),
    },
  },
};

describe('askSecrets', () => {
  it('asks only for the secrets of the way the model signs in, hidden', async () => {
    const answers = setupAnswers({ text: ['bk-key'], choices: [] });
    const secrets = await askSecrets({ adapter, ui: answers.ui, definition: { auth: 'api-key' } });

    expect(answers.questions).toEqual(['API key']);
    expect(answers.secrets).toEqual(['API key']);
    expect(secrets).toEqual({ apiKey: 'bk-key' });
  });

  it('asks for the access key pair, and for a session token it may leave empty', async () => {
    const answers = setupAnswers({ text: ['AKID', 'secret', ''], choices: [] });
    const secrets = await askSecrets({
      adapter,
      ui: answers.ui,
      definition: { auth: 'access-key' },
    });

    expect(answers.questions).toEqual([
      'Access key ID',
      'Secret access key',
      'Session token (optional)',
    ]);
    expect(secrets).toEqual({ accessKeyId: 'AKID', secretAccessKey: 'secret' });
  });

  it('sends a session token when one is entered', async () => {
    const answers = setupAnswers({ text: ['AKID', 'secret', 'token'], choices: [] });

    expect(
      await askSecrets({ adapter, ui: answers.ui, definition: { auth: 'access-key' } }),
    ).toEqual({ accessKeyId: 'AKID', secretAccessKey: 'secret', sessionToken: 'token' });
  });

  it('insists on a required secret but not on an optional one', async () => {
    const answers = setupAnswers({ text: [], choices: [] });
    let required: string | undefined;
    let optional: string | undefined;

    answers.ui.text = (question) => {
      if (question.title === 'Access key ID') required = question.validate?.('');
      if (question.title === 'Session token (optional)') optional = question.validate?.('');

      return Promise.resolve('x');
    };

    await askSecrets({ adapter, ui: answers.ui, definition: { auth: 'access-key' } });

    expect(required).toBe('Enter a key to continue.');
    expect(optional).toBeUndefined();
  });

  it('asks for every secret of an adapter that has one way to sign in, as before', async () => {
    const single: AdapterDescription = {
      kind: 'one-way',
      description: 'One way',
      secrets: ['apiKey'],
      config: {
        type: 'object',
        required: ['apiKey'],
        properties: { apiKey: { type: 'string', secret: true, title: 'API key' } },
      },
    };
    const answers = setupAnswers({ text: ['k'], choices: [] });

    expect(await askSecrets({ adapter: single, ui: answers.ui, definition: {} })).toEqual({
      apiKey: 'k',
    });
  });
});
