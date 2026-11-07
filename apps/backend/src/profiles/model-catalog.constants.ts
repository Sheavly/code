import type { ModelOffering } from '@sheavly/protocol/setup/setup.types';
import type { SetupHostingTemplate } from './model-catalog.types.js';

/** Setup suggestions belong to the app, not the generic provider registry. */
export const SETUP_MODELS = [
  { name: 'GPT-6.1 Sol', identity: { model: 'gpt-6.1-sol', family: 'gpt' } },
  { name: 'GPT-6 Astra', identity: { model: 'gpt-6-astra', family: 'gpt' } },
  { name: 'GPT-6 Luna', identity: { model: 'gpt-6-luna', family: 'gpt' } },
  { name: 'Claude Opus 5.5', identity: { model: 'claude-opus-5-5', family: 'claude' } },
  { name: 'Claude Sonnet 5.5', identity: { model: 'claude-sonnet-5-5', family: 'claude' } },
  { name: 'DeepSeek V4 Flash', identity: { model: 'deepseek-v4-flash', family: 'deepseek' } },
] satisfies Pick<ModelOffering, 'name' | 'identity'>[];

/** Only routes whose adapters are registered are advertised by the catalogue. */
export const SETUP_HOSTING = [
  {
    adapter: 'azure-openai',
    name: 'Azure',
    families: ['gpt'],
    modelField: 'deployment',
    defaults: {},
  },
  { adapter: 'openai', name: 'OpenAI', families: ['gpt'], modelField: 'model', defaults: {} },
  {
    adapter: 'azure-anthropic',
    name: 'Azure',
    families: ['claude'],
    modelField: 'deployment',
    defaults: { thinkingMode: 'adaptive' },
  },
  {
    adapter: 'azure-chat',
    name: 'Azure',
    families: ['deepseek'],
    modelField: 'deployment',
    defaults: { replayReasoning: true },
  },
] satisfies SetupHostingTemplate[];
