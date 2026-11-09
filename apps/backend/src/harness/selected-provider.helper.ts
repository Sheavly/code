import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { ModelSelection } from '@sheavly/protocol/model/model.types';
import { SetupError } from '../errors/setup.errors.js';
import type { ModelSwitch } from './harness.types.js';

/** Captures a sub-agent's provider and effort without changing the profile's remembered choice. */
export function selectedProvider(params: {
  models: ModelSwitch;
  onModelCall: ((request: ProviderRequest) => void) | undefined;
}) {
  const { models, onModelCall } = params;
  const choice = models.choices.find(({ id }) => id === models.switch.active);

  if (!choice) {
    throw new SetupError({
      reason: 'invalid',
      message: 'No model is selected for this sub-agent.',
    });
  }

  const selection: ModelSelection = {
    modelId: choice.id,
    mode: models.switch.activeMode ?? 'medium',
  };
  const pinned = models.switch.pinned(choice.id);

  return {
    selection,
    provider: {
      stream(request: ProviderRequest) {
        const selected = { ...request, mode: selection.mode };

        onModelCall?.(selected);

        return pinned.stream(selected);
      },
      // The sub-agent stays on this model, so it is told this model's window.
      contextWindow: pinned.contextWindow,
    },
  };
}
