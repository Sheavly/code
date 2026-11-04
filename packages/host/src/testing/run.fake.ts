import type { ConversationRun } from '../conversations/conversations.types.js';
import type { ModelChoice } from '@sheavly/protocol/server/server.types';

/**
 * Test-only: a conversation's run as an app reports it, with two models to switch between. Each
 * call makes its own, so one test's switch doesn't leak into another's.
 */
export function twoModelRun(): ConversationRun {
  const fast: ModelChoice = { name: 'fast', adapter: 'openai', model: 'gpt-5-mini' };
  const models: ModelChoice[] = [fast, { name: 'deep', adapter: 'azure-openai', model: 'gpt-5' }];
  let active = fast;

  return {
    details: () => ({
      workspace: '/work',
      model: active,
      models,
      projectTrust: 'no_hooks',
      skipAllowList: false,
    }),
    useModel: (name) => {
      const choice = models.find((model) => model.name === name);

      if (choice) active = choice;

      return choice !== undefined;
    },
  };
}
