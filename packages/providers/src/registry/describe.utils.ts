import { z } from 'zod';
import type { AdapterDescription } from '@sheavly/protocol/model/model.types';
import { FIELD_KIND } from '../http/http.constants.js';

/** The metadata a field of a config schema carries (`.meta({ secret: true })`). */
type FieldMeta = Record<string, unknown>;

/** The fields of a config's top-level object, by name, each with the metadata it was given. */
function fieldMetas(schema: z.ZodType): Map<string, FieldMeta> {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  const properties = (json.properties ?? {}) as Record<string, FieldMeta>;

  return new Map(Object.entries(properties));
}

/** Whether a field's JSON Schema was marked `kind` (`secret`, `host`). */
const isMarked = (params: { field: FieldMeta; kind: keyof typeof FIELD_KIND }) =>
  params.field[FIELD_KIND[params.kind]] === true;

/** The names of the fields of `schema` marked `kind`, in the order the schema declares them. */
export function fieldsMarked(params: {
  schema: z.ZodType;
  kind: keyof typeof FIELD_KIND;
}): string[] {
  const { schema, kind } = params;

  return [...fieldMetas(schema)].flatMap(([name, field]) =>
    isMarked({ field, kind }) ? [name] : [],
  );
}

/**
 * What a UI needs to build a form for an adapter: its config as JSON Schema without the fields
 * the host supplies (the request policy), with the secret fields kept and marked, and the names
 * of the secrets. Properties are in the order the schema declares them, so a form reads the way
 * the adapter lists its fields.
 */
export function describeAdapter(params: {
  kind: string;
  description: string;
  schema: z.ZodType;
  remoteField?: string | undefined;
}): AdapterDescription {
  const { kind, description, schema, remoteField } = params;
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  const hostOwned = new Set(fieldsMarked({ schema, kind: 'host' }));
  const properties = Object.fromEntries(
    Object.entries((json.properties ?? {}) as Record<string, FieldMeta>).filter(
      ([name]) => !hostOwned.has(name),
    ),
  );
  const required = (json.required ?? []).filter((name) => !hostOwned.has(name));

  return {
    kind,
    description,
    config: { type: 'object', properties, ...(required.length > 0 && { required }) },
    secrets: fieldsMarked({ schema, kind: 'secret' }),
    ...(remoteField !== undefined && { remoteField }),
  };
}
