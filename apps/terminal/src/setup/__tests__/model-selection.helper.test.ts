import { describe, expect, it } from 'vitest';
import type { AdapterDescription } from '@sheavly/protocol/model/model.types';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { fakeSetupBackend, setupAnswers } from '../../testing/setup.fake.js';
import { configureModel } from '../model.helper.js';

const profile = profileIdSchema.parse('11111111-1111-4111-8111-111111111111');
const azure: AdapterDescription = {
  kind: 'azure-chat',
  description: 'Azure Chat Completions',
  remoteField: 'deployment',
  secrets: ['apiKey'],
  config: {
    type: 'object',
    required: ['baseUrl', 'deployment', 'apiKey'],
    properties: {
      baseUrl: { type: 'string', title: 'Endpoint' },
      deployment: { type: 'string', title: 'Deployment' },
      replayReasoning: { type: 'boolean', default: false },
      apiKey: { type: 'string', title: 'API key', secret: true },
    },
  },
};

describe('adding a model before selecting its host', () => {
  it('chooses DeepSeek then Azure, preserving model identity separately from deployment and key', async () => {
    const backend = fakeSetupBackend({
      adapters: [azure],
      catalog: [
        {
          name: 'DeepSeek V4 Flash',
          identity: { model: 'deepseek-v4-flash', family: 'deepseek' },
          hosts: [
            {
              adapter: 'azure-chat',
              name: 'Azure',
              defaults: { deployment: 'deepseek-v4-flash', replayReasoning: true },
              fixed: {},
            },
          ],
        },
      ],
    });

    backend.state.profiles.push({ id: profile, name: 'Work', ready: false, models: [] });
    const { ui, questions, secrets, notices } = setupAnswers({
      choices: ['deepseek-v4-flash', 'azure-chat', 'start'],
      text: ['https://azure.test/models', 'production-flash', 'hidden-key'],
    });
    const originalText = ui.text;

    ui.text = (question) => {
      if (question.title === 'Deployment') expect(question.initial).toBe('deepseek-v4-flash');

      return originalText(question);
    };

    const id = await configureModel({ client: backend.client, ui, profile });

    expect(questions.slice(0, 2)).toEqual([
      'What model do you want to add?',
      'How do you want to host DeepSeek V4 Flash?',
    ]);
    expect(backend.modelOf(profile, id)).toMatchObject({
      name: 'DeepSeek V4 Flash',
      identity: { model: 'deepseek-v4-flash', family: 'deepseek' },
      definition: {
        baseUrl: 'https://azure.test/models',
        deployment: 'production-flash',
        replayReasoning: true,
      },
    });
    expect(secrets).toEqual(['API key']);
    expect(JSON.stringify(backend.state) + notices.join('')).not.toContain('hidden-key');
    expect(backend.calls.map(({ name }) => name)).not.toContain('checkCredential');
  });

  it('does not ask for the chosen native model again', async () => {
    const openai: AdapterDescription = {
      kind: 'openai',
      description: 'OpenAI',
      remoteField: 'model',
      secrets: ['apiKey'],
      config: {
        type: 'object',
        required: ['model', 'apiKey'],
        properties: {
          model: { type: 'string', title: 'Provider model' },
          baseUrl: { type: 'string', default: 'https://api.openai.com/v1' },
          apiKey: { type: 'string', secret: true, title: 'API key' },
        },
      },
    };
    const backend = fakeSetupBackend({
      adapters: [openai],
      catalog: [
        {
          name: 'Sol',
          identity: { model: 'gpt-6.1-sol', family: 'gpt' },
          hosts: [
            { name: 'OpenAI', adapter: 'openai', defaults: {}, fixed: { model: 'gpt-6.1-sol' } },
          ],
        },
      ],
    });

    backend.state.profiles.push({ id: profile, name: 'Work', ready: false, models: [] });
    const { ui, questions } = setupAnswers({
      choices: ['gpt-6.1-sol', 'openai', 'start'],
      text: ['key'],
    });
    const id = await configureModel({ client: backend.client, ui, profile });

    expect(questions).not.toContain('Provider model');
    expect(backend.modelOf(profile, id)).toMatchObject({
      name: 'Sol',
      identity: { model: 'gpt-6.1-sol', family: 'gpt' },
      definition: { model: 'gpt-6.1-sol' },
    });
  });

  it('rejects a model whose hosting route is unavailable before storing a model or key', async () => {
    const backend = fakeSetupBackend({
      adapters: [azure],
      catalog: [
        {
          name: 'Opus',
          identity: { model: 'claude-opus-5-5', family: 'claude' },
          hosts: [{ name: 'Anthropic', adapter: 'anthropic', defaults: {}, fixed: {} }],
        },
      ],
    });

    backend.state.profiles.push({ id: profile, name: 'Work', ready: false, models: [] });
    const { ui } = setupAnswers({ choices: ['claude-opus-5-5'], text: [] });

    await expect(configureModel({ client: backend.client, ui, profile })).rejects.toThrow(
      'no hosting',
    );
    expect(backend.calls.some(({ name }) => name.startsWith('put'))).toBe(false);
  });
});
