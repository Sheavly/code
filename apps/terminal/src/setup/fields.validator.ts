import { z } from 'zod';
import type { AdapterDescription } from '@sheavly/protocol/model/model.types';
import { SetupError } from '../errors/setup.errors.js';
import type { SetupField } from './setup.types.js';

/** The scalar JSON Schema fields supported by the terminal's provider form. */
export const fieldSchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean']),
  title: z.string().exactOptional(),
  description: z.string().exactOptional(),
  secret: z.boolean().exactOptional(),
  default: z.union([z.string(), z.number(), z.boolean()]).exactOptional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).exactOptional(),
  format: z.string().exactOptional(),
  pattern: z.string().exactOptional(),
  minLength: z.number().exactOptional(),
  maxLength: z.number().exactOptional(),
  minimum: z.number().exactOptional(),
  maximum: z.number().exactOptional(),
  exclusiveMinimum: z.number().exactOptional(),
  exclusiveMaximum: z.number().exactOptional(),
});

const formSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), fieldSchema),
  required: z.array(z.string()).default([]),
});

/** Refuses unsupported schemas explicitly rather than silently dropping provider settings. */
export function parseAdapterForm(adapter: AdapterDescription) {
  const parsed = formSchema.safeParse(adapter.config);

  if (!parsed.success) {
    throw new SetupError(`The terminal cannot display the settings for ${adapter.kind}.`);
  }

  return parsed.data;
}

/** Converts entered text once; the provider still validates the complete definition on save. */
export function parseFieldValue(params: { field: SetupField; text: string }): unknown {
  const { field, text } = params;

  if (field.type === 'boolean') return text === 'true';
  if (field.type === 'number' || field.type === 'integer') return Number(text);

  return text;
}

export function fieldProblem(params: {
  field: SetupField;
  required: boolean;
  text: string;
}): string | undefined {
  const { field, required, text } = params;

  if (!text) return required ? 'This field is required.' : undefined;

  const result = z.fromJSONSchema(field).safeParse(parseFieldValue({ field, text }));

  if (!result.success) return 'Enter a valid value for this field.';

  return undefined;
}
