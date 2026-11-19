import { randomUUID } from 'node:crypto';
import { RefusedError } from '@sheavly/client/errors/client.errors';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import type { AnswerOf } from '@sheavly/client/client/client.types';
import { SetupError } from '../errors/setup.errors.js';
import { askContextWindow, askDefinition, askSecrets } from './form.helper.js';
import type { ModelSetup, SetupClient, SetupUi } from './setup.types.js';
import { fieldText, modelActions } from './setup.utils.js';
import { chooseModelToAdd } from './model-selection.helper.js';

/** Adds or repairs a model, and lets the user explicitly test its connection before continuing. */
export async function configureModel(params: {
  client: SetupClient;
  ui: SetupUi;
  profile: ProfileId;
  existing?: AnswerOf<'getModel'>;
}): Promise<ModelId> {
  const { client, ui, profile, existing } = params;
  const { adapters } = await client.call('listAdapters', { signal: ui.signal });

  if (adapters.length === 0) throw new SetupError('This backend has no model providers available.');

  const preset = existing ? undefined : await chooseModelToAdd({ client, ui, adapters });
  const kind = existing?.adapter ?? preset?.host.adapter;
  const adapter = adapters.find((item) => item.kind === kind);

  if (!adapter) throw new SetupError(`Provider ${kind} is unavailable on this backend.`);

  const model = existing?.id ?? modelIdSchema.parse(randomUUID());
  const target = { client, ui, profile, model, adapter, ...(preset && { preset }) };

  if (!existing) {
    await saveDefinition({ ...target, previous: undefined });
    await saveSecrets(target);
  }

  return finishModel(target);
}

async function saveDefinition(
  params: ModelSetup & {
    previous: AnswerOf<'getModel'> | undefined;
  },
): Promise<void> {
  const { client, ui, profile, model, adapter, previous } = params;
  const name = previous
    ? await ui.text({
        title: 'Model display name',
        description: 'A label for you. The provider model or deployment is entered separately.',
        initial: previous?.name ?? '',
        validate: (value) =>
          value.length > 0 && value.length <= 80 ? undefined : 'Use 1 to 80 characters.',
      })
    : undefined;
  // Asked once, before the settings: a refused setting asks only for the settings again.
  const contextWindow = await askContextWindow({ ui, current: previous?.contextWindow });
  let definition = previous?.definition ?? params.preset?.host.defaults ?? {};
  const identity = previous?.identity ?? params.preset?.identity;

  while (true) {
    definition = await askDefinition({
      adapter,
      ui,
      previous: definition,
      advanced: previous !== undefined,
      ...(params.preset && { fixed: params.preset.host.fixed }),
    });

    try {
      await client.send('putModel', {
        profile,
        model,
        body: {
          name:
            name ??
            params.preset?.name ??
            (fieldText(definition[adapter.remoteField ?? '']) || adapter.kind).slice(0, 80),
          adapter: adapter.kind,
          definition,
          ...(identity && { identity }),
          ...(previous?.pricing && { pricing: previous.pricing }),
          contextWindow,
        },
        signal: ui.signal,
      });

      return;
    } catch (caughtError) {
      if (!(caughtError instanceof RefusedError) || caughtError.status !== 422) throw caughtError;
      // Cross-field constraints belong to the adapter, which returns a value-free explanation.
      ui.notice(caughtError.message);
    }
  }
}

async function saveSecrets(params: ModelSetup): Promise<void> {
  const { client, ui, profile, model, adapter } = params;

  if (adapter.secrets.length === 0) return;

  // The secrets asked for depend on the settings just saved (how the model signs in).
  const { definition } = await client.call('getModel', { profile, model, signal: ui.signal });
  const secrets = await askSecrets({ adapter, ui, definition });

  await client.send('putCredential', { profile, model, body: { secrets }, signal: ui.signal });
}

async function finishModel(params: ModelSetup): Promise<ModelId> {
  const { client, ui, profile, model, adapter } = params;

  while (true) {
    const current = await client.call('getModel', { profile, model, signal: ui.signal });
    const items = modelActions({ usable: current.usable, hasSecrets: adapter.secrets.length > 0 });

    const action = await ui.choose({ title: `${current.name} · ${current.credential}`, items });

    if (action === 'start') return model;
    if (action === 'key') await saveSecrets(params);
    if (action === 'edit') await saveDefinition({ ...params, previous: current });

    if (action === 'check') {
      ui.notice('Checking the connection…');
      const result = await client.call('checkCredential', { profile, model, signal: ui.signal });

      ui.notice(result.status === 'valid' ? 'Connection successful.' : result.message);
    }
  }
}
