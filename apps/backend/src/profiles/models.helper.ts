import type { ModelId, ModelMode } from '@sheavly/protocol/model/model.types';
import { AdapterError } from '@sheavly/providers/errors/providers.errors';
import type { AdapterRegistry } from '@sheavly/providers/registry/registry.service';
import { ProviderSwitch } from '@sheavly/providers/switch/switch.service';
import type { OpenProfile } from '@sheavly/storage/profile-registry/open-profile.service';
import type { ModelSwitch } from '../harness/harness.types.js';
import type { ProfileModels, RequestSettings } from './profiles.types.js';
import { withContextWindow } from '../usage/context-window.helper.js';
import { pricedProvider } from '../usage/priced-provider.helper.js';

/**
 * A profile's models, each combined with its secrets and built into a provider by the adapter
 * registry, behind one `ProviderSwitch` keyed by model id (the one thing that names a model; the
 * name is only its label). The switch starts on `startWith` (the profile's last model) when it
 * is among them, else on the first.
 *
 * A model that can't be built (no key set, a definition its adapter refuses, an adapter this
 * backend doesn't have) is left out with a note, so one bad file never costs the user the others;
 * a note says which model and why in words of this function's, never the key and never the
 * adapter's own message, which may quote a value. `models.choices` is empty when none is usable.
 */
export async function modelsOf(params: {
  profile: OpenProfile;
  registry: AdapterRegistry;
  request: RequestSettings;
  startWith?: ModelId | undefined;
  modes?: Partial<Record<ModelId, ModelMode>>;
  /** The window every model is told, instead of its file's (`CONTEXT_WINDOW`). */
  contextWindow?: number | undefined;
}): Promise<ProfileModels> {
  const { profile, registry, request, startWith, contextWindow } = params;
  const { models: stored, problems } = await profile.listModels();
  const remoteFields = new Map(registry.describe().map((a) => [a.kind, a.remoteField]));
  const models: ModelSwitch = { switch: new ProviderSwitch(), choices: [] };
  const notes = problems.map((problem) => problem.message);

  for (const model of stored) {
    const secrets = await profile.getSecrets(model.id);

    try {
      const provider = registry.create(model.adapter, {
        ...model.definition,
        ...secrets,
        request,
      });
      const remote = model.definition[remoteFields.get(model.adapter) ?? ''];

      models.switch.add(
        model.id,
        withContextWindow({
          provider: pricedProvider({ provider, model }),
          model,
          override: contextWindow,
        }),
      );
      models.switch.setMode({ name: model.id, mode: params.modes?.[model.id] ?? 'medium' });
      models.choices.push({
        id: model.id,
        name: model.name,
        adapter: model.adapter,
        model: typeof remote === 'string' ? remote : model.name,
      });
    } catch (caughtError) {
      // Only a model the adapter can't be built from is skipped; any other failure is not ours to hide.
      if (!(caughtError instanceof AdapterError)) throw caughtError;
      notes.push(
        `Model "${model.name}" (${model.adapter}) is left out: its definition or key is not usable. Check its fields and set its key.`,
      );
    }
  }

  if (startWith && models.choices.some((choice) => choice.id === startWith)) {
    models.switch.use(startWith);
  }

  return { models, notes };
}
