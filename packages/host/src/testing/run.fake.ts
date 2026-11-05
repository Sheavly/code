import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import type { ModelChoice } from '@sheavly/protocol/server/server.types';
import type { ConversationRun } from '../conversations/conversations.types.js';

/** Test-only: the ids of `twoModelRun`'s models. */
export const FAST_ID = modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
export const DEEP_ID = modelIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71');

/** Test-only: the profile `twoModelRun` says it runs on. */
export const TEST_PROFILE_ID = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b99');

/**
 * Test-only: a conversation's run as an app reports it, with two models to switch between. Both
 * are labelled "Astra", as two models may be: only the id tells them apart. Each call makes its
 * own, so one test's switch doesn't leak into another's.
 */
export function twoModelRun(): ConversationRun {
  const fast: ModelChoice = { id: FAST_ID, name: 'Astra', adapter: 'openai', model: 'gpt-5-mini' };
  const deep: ModelChoice = { id: DEEP_ID, name: 'Astra', adapter: 'azure-openai', model: 'gpt-5' };
  const models = [fast, deep];
  let active = fast;

  return {
    details: () => ({
      workspace: '/work',
      profile: TEST_PROFILE_ID,
      model: active,
      models,
      projectTrust: 'no_hooks',
      skipAllowList: false,
    }),
    useModel: (id) => {
      const choice = models.find((model) => model.id === id);

      if (choice) active = choice;

      return choice !== undefined;
    },
  };
}
