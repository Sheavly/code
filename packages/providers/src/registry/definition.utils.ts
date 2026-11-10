import type { z } from 'zod';
import { fieldsMarked } from './describe.utils.js';
import { SECRET_STAND_IN } from './registry.constants.js';
import type { DefinitionProblem } from './registry.types.js';

/**
 * What is wrong with `definition` as the fields of a model for an adapter whose config is
 * `schema`, checked without its secret: the secret fields get a stand-in, `host` supplies what the
 * backend fills in (the request policy), and everything else is checked by the adapter's own
 * schema, so a bad address or an out-of-range number is caught before a key is ever entered. A
 * secret in the definition is itself a problem: a model's file holds none. Empty when it is fine.
 */
export function definitionProblems(params: {
  schema: z.ZodType;
  definition: Record<string, unknown>;
  host: Record<string, unknown>;
}): DefinitionProblem[] {
  const { schema, definition, host } = params;
  const secrets = fieldsMarked({ schema, kind: 'secret' });
  const leaked = secrets.filter((name) => name in definition);
  const standIns = Object.fromEntries(secrets.map((name) => [name, SECRET_STAND_IN]));
  const parsed = schema.safeParse({ ...definition, ...host, ...standIns });
  const found = parsed.success
    ? []
    : parsed.error.issues
        .filter((issue) => !secrets.includes(String(issue.path[0])))
        .map((issue) => ({ field: issue.path.join('.') || '(model)', message: issue.message }));

  return [
    ...leaked.map((field) => ({
      field,
      message: 'A model’s file holds no secret: a key goes to the credentials',
    })),
    ...found,
  ];
}
