import type { AdapterDescription } from '@sheavly/protocol/model/model.types';
import { fieldProblem, parseAdapterForm, parseFieldValue } from './fields.validator.js';
import type { SetupField, SetupUi } from './setup.types.js';
import { fieldText } from './setup.utils.js';

/** Public settings only. Secret-marked fields never enter a model definition. */
export async function askDefinition(params: {
  adapter: AdapterDescription;
  ui: SetupUi;
  previous: Record<string, unknown>;
  advanced?: boolean;
}): Promise<Record<string, unknown>> {
  const { adapter, ui, previous } = params;
  const form = parseAdapterForm(adapter);
  const definition: Record<string, unknown> = {};

  for (const [name, field] of Object.entries(form.properties)) {
    if (field.secret || adapter.secrets.includes(name)) continue;

    if (!params.advanced && !form.required.includes(name)) {
      const value = previous[name] ?? field.default;

      if (value !== undefined) definition[name] = value;
      continue;
    }

    const value = await askField({
      name,
      field,
      required: form.required.includes(name),
      initial: previous[name] ?? field.default,
      ui,
    });

    if (value !== undefined) definition[name] = value;
  }

  return definition;
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

/** Values exist only for the write-only credential request, never for a settings preview. */
export async function askSecrets(params: { adapter: AdapterDescription; ui: SetupUi }) {
  const { adapter, ui } = params;
  const form = parseAdapterForm(adapter);
  const secrets: Record<string, string> = {};

  for (const name of adapter.secrets) {
    secrets[name] = await ui.text({
      title: form.properties[name]?.title ?? name,
      description: 'Input is hidden. The backend stores this key separately from model settings.',
      secret: true,
      validate: (value) => (value ? undefined : 'Enter a key to continue.'),
    });
  }

  return secrets;
}
