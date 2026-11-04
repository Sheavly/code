import { z } from 'zod';
import { CLAUDE_MAX_TOKENS } from './harness.constants.js';

/** An empty line in `.env` means "not set". */
const optional = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const required = (key: string) => z.string({ error: `Set ${key}` }).min(1, `Set ${key}`);

/** A whole number from env, or `fallback` when it is unset (applied last, so it runs on a missing key). */
const wholeNumber = (params: { key: string; fallback?: number }) =>
  optional
    .transform((value) => (value === undefined ? undefined : Number(value)))
    .pipe(
      z
        .number({ error: `Set ${params.key} to a whole number` })
        .int()
        .positive()
        .optional(),
    )
    .transform((value) => value ?? params.fallback);

/** `true` or `false` from env, or `fallback` when it is unset. */
const flag = (params: { key: string; fallback: boolean }) =>
  optional
    .pipe(z.enum(['true', 'false'], `Set ${params.key} to true or false`).optional())
    .transform((value) => (value === undefined ? params.fallback : value === 'true'));

/**
 * One model's settings, read from the keys named after it: model `claude` reads `CLAUDE_ADAPTER`,
 * `CLAUDE_API_KEY`, ... Each key that is missing or wrong is named in the error.
 */
function modelEnvSchema(prefix: string) {
  const key = (field: string) => `${prefix}_${field}`;
  const shared = {
    API_KEY: required(key('API_KEY')),
    BASE_URL: required(key('BASE_URL')),
    DEPLOYMENT: required(key('DEPLOYMENT')),
  };

  return z.discriminatedUnion(
    'ADAPTER',
    [
      z.object({
        ADAPTER: z.literal('azure-openai'),
        ...shared,
        API_VERSION: optional,
        REASONING: flag({ key: key('REASONING'), fallback: true }),
      }),
      z.object({
        ADAPTER: z.literal('azure-anthropic'),
        ...shared,
        MAX_TOKENS: wholeNumber({ key: key('MAX_TOKENS'), fallback: CLAUDE_MAX_TOKENS }),
        THINKING_BUDGET: wholeNumber({ key: key('THINKING_BUDGET') }),
      }),
    ],
    { error: `Set ${key('ADAPTER')} to azure-openai or azure-anthropic` },
  );
}

/** What `/model <name>` takes, and what its keys are named after. */
const modelNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'A name in MODELS is lowercase letters, digits and dashes');

const modelNamesSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(modelNameSchema)
      .min(1, 'Set MODELS to at least one name')
      .refine((names) => new Set(names).size === names.length, 'A name in MODELS is listed twice'),
  );

/** The env keys a model's settings start with: `deepseek-flash` reads `DEEPSEEK_FLASH_*`. */
const prefixOf = (name: string) => name.toUpperCase().replaceAll('-', '_');

/**
 * The models in `MODELS` (comma-separated names, the first one starts active), each with its own
 * key, endpoint and deployment. Undefined when `MODELS` is unset: the single `ADAPTER` is used.
 */
export function parseModelsEnv(env: Record<string, string | undefined>) {
  if (env.MODELS === undefined || env.MODELS === '') return undefined;

  return modelNamesSchema.parse(env.MODELS).map((name) => {
    const prefix = prefixOf(name);
    const fields = Object.fromEntries(
      Object.entries(env).flatMap(([key, value]) =>
        key.startsWith(`${prefix}_`) ? [[key.slice(prefix.length + 1), value]] : [],
      ),
    );

    return { name, settings: modelEnvSchema(prefix).parse(fields) };
  });
}
