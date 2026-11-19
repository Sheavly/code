import {
  CONTEXT_WINDOW_CHOICES,
  DEFAULT_CONTEXT_WINDOW,
} from '@sheavly/protocol/model/model.constants';
import type { AdapterDescription } from '@sheavly/protocol/model/model.types';
import { contextWindowLabel } from '@sheavly/protocol/model/model.utils';
import { SetupError } from '../errors/setup.errors.js';
import { fieldProblem, parseAdapterForm, parseFieldValue } from './fields.validator.js';
import type { SetupField, SetupUi } from './setup.types.js';
import { fieldText } from './setup.utils.js';

/**
 * Which context size the agent is told: "300K" or "1M", starting on the model's current size, or
 * the default. A model given another size by hand or by its host keeps it as an item of its own,
 * labelled by its exact count, so it is shown for what it is and an edit never changes it unseen.
 * The size is only what the agent paces itself by, so the question says that a smaller one costs
 * less and limits nothing.
 */
export async function askContextWindow(params: {
  ui: SetupUi;
  current: number | undefined;
}): Promise<number> {
  const { ui, current } = params;
  const offered: number[] = CONTEXT_WINDOW_CHOICES.map(({ size }) => size);
  const own = current === undefined || offered.includes(current) ? [] : [current];
  const sizes = [...own, ...offered];
  const picked = await ui.choose({
    title:
      'Context size\nHow much context the agent is told it has. It paces itself by it, so a smaller size tends to cost less. It does not limit what the provider accepts or change its prices.',
    items: sizes.map((size) => ({ value: String(size), label: contextWindowLabel(size) })),
    initial: String(current ?? DEFAULT_CONTEXT_WINDOW),
  });
  const size = sizes.find((candidate) => String(candidate) === picked);

  if (size === undefined) throw new SetupError('That is not one of the sizes offered.');

  return size;
}

/** Public settings only. Secret-marked fields never enter a model definition. */
export async function askDefinition(params: {
  adapter: AdapterDescription;
  ui: SetupUi;
  previous: Record<string, unknown>;
  advanced?: boolean;
  fixed?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { adapter, ui, previous } = params;
  const form = parseAdapterForm(adapter);
  const definition: Record<string, unknown> = {};

  for (const [name, field] of Object.entries(form.properties)) {
    if (field.secret || adapter.secrets.includes(name)) continue;

    if (params.fixed && Object.hasOwn(params.fixed, name)) {
      definition[name] = params.fixed[name];
      continue;
    }

    const initial = initialFieldValue({ previous, name, field });

    if (!params.advanced && !form.required.includes(name)) {
      if (initial !== undefined) definition[name] = initial;
      continue;
    }

    const value = await askField({
      name,
      field,
      required: form.required.includes(name),
      initial,
      ui,
    });

    if (value !== undefined) definition[name] = value;
  }

  return definition;
}

/** Prototype members are not saved settings; only own values can replace provider defaults. */
function initialFieldValue(params: {
  previous: Record<string, unknown>;
  name: string;
  field: SetupField;
}): unknown {
  const { previous, name, field } = params;

  if (!Object.hasOwn(previous, name)) return field.default;

  return previous[name] ?? field.default;
}

async function askField(params: {
  name: string;
  field: SetupField;
  required: boolean;
  initial: unknown;
  ui: SetupUi;
}): Promise<unknown> {
  const { name, field, required, initial, ui } = params;
  const title = field.title ?? name;
  const choices = field.enum ?? (field.type === 'boolean' ? [true, false] : undefined);

  if (choices) {
    const items = choices.map((value) => ({ value: String(value), label: String(value) }));

    if (!required) items.unshift({ value: '', label: 'Use provider default' });
    const picked = await ui.choose({
      title: field.description ? `${title}\n${field.description}` : title,
      items,
      initial: fieldText(initial),
    });

    return picked === '' ? undefined : parseFieldValue({ field, text: picked });
  }

  const text = await ui.text({
    title: required ? title : `${title} (optional)`,
    description: field.description ?? 'Leave optional fields empty to use the provider default.',
    initial: fieldText(initial),
    validate: (value) => fieldProblem({ field, required, text: value }),
  });

  return text === '' ? undefined : parseFieldValue({ field, text });
}

/**
 * Values exist only for the write-only credential request, never for a settings preview. A secret
 * that applies only to some settings (`appliesWhen`) is asked for when `definition` has them, so a
 * model that signs in one way is never asked for the secrets of another; an optional one may be
 * left empty and is then not sent.
 */
export async function askSecrets(params: {
  adapter: AdapterDescription;
  ui: SetupUi;
  definition: Record<string, unknown>;
}) {
  const { adapter, ui, definition } = params;
  const form = parseAdapterForm(adapter);
  const secrets: Record<string, string> = {};

  for (const name of adapter.secrets) {
    const field = form.properties[name];
    const applies = Object.entries(field?.appliesWhen ?? {}).every(
      ([setting, value]) => definition[setting] === value,
    );

    if (!applies) continue;

    const optional = field?.optional === true;
    const title = field?.title ?? name;
    const value = await ui.text({
      title: optional ? `${title} (optional)` : title,
      description:
        field?.description ??
        'Input is hidden. The backend stores this key separately from model settings.',
      secret: true,
      validate: (entered) => (entered || optional ? undefined : 'Enter a key to continue.'),
    });

    if (value) secrets[name] = value;
  }

  return secrets;
}
