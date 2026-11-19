import type { SetupHostingTemplate, SetupModelTemplate } from './model-catalog.types.js';

/** Setup suggestions belong to the app, not the generic provider registry. */
export const SETUP_MODELS: SetupModelTemplate[] = [
  { name: 'GPT-6.1 Sol', identity: { model: 'gpt-6.1-sol', family: 'gpt' } },
  { name: 'GPT-6 Astra', identity: { model: 'gpt-6-astra', family: 'gpt' } },
  { name: 'GPT-6 Luna', identity: { model: 'gpt-6-luna', family: 'gpt' } },
  { name: 'Claude Opus 5.5', identity: { model: 'claude-opus-5-5', family: 'claude' } },
  { name: 'Claude Sonnet 5.5', identity: { model: 'claude-sonnet-5-5', family: 'claude' } },
  { name: 'DeepSeek V4 Flash', identity: { model: 'deepseek-v4-flash', family: 'deepseek' } },
  {
    name: 'DeepSeek V4.1 Flash (1017)',
    identity: { model: 'DeepSeek-V4.1-Flash-1017', family: 'deepseek' },
    hostingPresets: {
      'azure-chat': { replayReasoning: true, thinkingMode: 'enabled', effortProfile: 'deepseek' },
    },
  },
];

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
  {
    adapter: 'bedrock-anthropic',
    name: 'AWS Bedrock',
    families: ['claude'],
    modelField: 'profile',
    profileOwner: 'anthropic',
    defaults: { thinkingMode: 'adaptive' },
  },
  {
    adapter: 'bedrock-openai',
    name: 'AWS Bedrock',
    families: ['gpt'],
    modelField: 'profile',
    profileOwner: 'openai',
    defaults: {},
  },
] satisfies SetupHostingTemplate[];
