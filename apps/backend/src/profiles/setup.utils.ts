import type { Model } from '@sheavly/protocol/model/model.types';
import type { Setup } from '@sheavly/protocol/setup/setup.types';

type CredentialState = Setup['profiles'][number]['models'][number]['credential'];

/**
 * Whether a model has the secrets its adapter needs. `required` is the adapter's secret field
 * names, or `undefined` when the adapter isn't known (then any secret set counts, since what it
 * needs can't be said).
 */
export function credentialState(params: {
  required: readonly string[] | undefined;
  set: readonly string[];
}): CredentialState {
  const { required, set } = params;

  if (required === undefined) return set.length > 0 ? 'set' : 'missing';
  if (required.length === 0) return 'not_needed';

  return required.every((field) => set.includes(field)) ? 'set' : 'missing';
}

/**
 * A definition without its secret fields. A model's file holds none, but one edited by hand might,
 * and no route may answer with a key whatever the file says.
 */
export function withoutSecrets(params: {
  definition: Record<string, unknown>;
  secrets: readonly string[];
}): Record<string, unknown> {
  const { definition, secrets } = params;

  return Object.fromEntries(
    Object.entries(definition).filter(([field]) => !secrets.includes(field)),
  );
}

/**
 * Whether `model` matches `search`: its name, its adapter or what the provider calls it (the
 * adapter's `remoteField` in its definition) has it, ignoring case.
 */
export function matchesModel(params: {
  model: Model;
  remoteField: string | undefined;
  search: string;
}): boolean {
  const { model, remoteField, search } = params;
  const wanted = search.toLowerCase();
  const remote = remoteField === undefined ? undefined : model.definition[remoteField];

  return [model.name, model.adapter, typeof remote === 'string' ? remote : ''].some((text) =>
    text.toLowerCase().includes(wanted),
  );
}
