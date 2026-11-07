import type { AdapterDescription } from '@sheavly/protocol/model/model.types';
import type { ModelOffering } from '@sheavly/protocol/setup/setup.types';
import { SetupError } from '../errors/setup.errors.js';
import type { ModelSetupPreset, SetupClient, SetupUi } from './setup.types.js';

/** Chooses the model first; only then asks which supported route should host it. */
export async function chooseModelToAdd(params: {
  client: SetupClient;
  ui: SetupUi;
  adapters: AdapterDescription[];
}): Promise<ModelSetupPreset> {
  const { client, ui, adapters } = params;
  const { models } = await client.call('listModelCatalog', { signal: ui.signal });
  const picked = await ui.choose({
    title: 'What model do you want to add?',
    items: [
      ...models.map(({ identity, name }) => ({ value: identity.model, label: name })),
      { value: 'custom', label: 'Custom model' },
    ],
  });
  const offering =
    picked === 'custom'
      ? await customModel({ ui, adapters, models })
      : models.find(({ identity }) => identity.model === picked);

  if (!offering) throw new SetupError('The selected model is unavailable. Restart setup.');

  const hosts = offering.hosts.filter((host) => adapters.some(({ kind }) => kind === host.adapter));

  if (hosts.length === 0) {
    throw new SetupError('This backend has no hosting provider for that model.');
  }

  const hosting = await ui.choose({
    title: `How do you want to host ${offering.name}?`,
    items: hosts.map(({ adapter, name }) => ({ value: adapter, label: name })),
  });
  const host = hosts.find(({ adapter }) => adapter === hosting);

  if (!host) throw new SetupError('The selected hosting provider is unavailable. Restart setup.');

  return { name: offering.name, identity: offering.identity, host };
}

async function customModel(params: {
  ui: SetupUi;
  adapters: AdapterDescription[];
  models: ModelOffering[];
}): Promise<ModelOffering> {
  const { ui, adapters, models } = params;
  const model = await ui.text({
    title: 'Model name or identifier',
    description: 'The model you want to run. Its hosting deployment is configured separately.',
    validate: (value) =>
      value.trim().length > 0 && value.trim().length <= 200
        ? undefined
        : 'Use 1 to 200 characters.',
  });
  const identity = model.trim();
  const known = models.find((entry) => entry.identity.model === identity);

  if (known) return known;

  return {
    name: identity.slice(0, 80),
    identity: { model: identity },
    hosts: adapters.map((adapter) => ({
      adapter: adapter.kind,
      name: adapter.description,
      defaults: adapter.remoteField ? { [adapter.remoteField]: identity } : {},
      fixed: {},
    })),
  };
}
