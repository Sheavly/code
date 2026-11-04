import { z } from 'zod';
import { DEFAULT_ADAPTER, DEFAULT_MODEL, MAX_TURNS, REQUEST, SERVER } from './harness.constants.js';

/** An empty line in `.env` (`AZURE_OPENAI_API_VERSION=`) means "not set". */
const optionalSetting = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

/**
 * The most retries a policy allows (`requestPolicySchema`), so a bad `MODEL_RETRIES` is named
 * here rather than failing later as an invalid adapter config.
 */
const MAX_RETRIES = 10;

/** A whole number of milliseconds or retries from env, or the default when it is unset. */
const count = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(z.number().int().min(0));

/**
 * How the terminal sends a model call: `MODEL_RESPONSE_TIMEOUT_MS`, `MODEL_RETRIES` and
 * `MODEL_RETRY_DELAY_MS`, each defaulting to `REQUEST`.
 */
const requestEnvSchema = z.object({
  MODEL_RESPONSE_TIMEOUT_MS: count(REQUEST.responseTimeoutMs).pipe(z.number().positive()),
  MODEL_RETRIES: count(REQUEST.retries).pipe(
    z.number().max(MAX_RETRIES, `Set MODEL_RETRIES to at most ${String(MAX_RETRIES)}`),
  ),
  MODEL_RETRY_DELAY_MS: count(REQUEST.retryDelayMs),
});

/** The request policy from `env`. */
export function parseRequestEnv(env: Record<string, string | undefined>) {
  const parsed = requestEnvSchema.parse(env);

  return {
    responseTimeoutMs: parsed.MODEL_RESPONSE_TIMEOUT_MS,
    retries: parsed.MODEL_RETRIES,
    retryDelayMs: parsed.MODEL_RETRY_DELAY_MS,
  };
}

/**
 * The model backend settings a host reads from the environment: `ADAPTER` picks "openai" (the
 * default) or "azure-openai", each with its own keys. Each missing key names what to set.
 */
const providerEnvSchema = z.discriminatedUnion('ADAPTER', [
  z.object({
    ADAPTER: z.literal('openai'),
    OPENAI_API_KEY: z.string().min(1, 'Set OPENAI_API_KEY'),
    MODEL: z.string().default(DEFAULT_MODEL),
  }),
  z.object({
    ADAPTER: z.literal('azure-openai'),
    AZURE_OPENAI_API_KEY: z.string().min(1, 'Set AZURE_OPENAI_API_KEY'),
    AZURE_OPENAI_BASE_URL: z.string().min(1, 'Set AZURE_OPENAI_BASE_URL'),
    AZURE_OPENAI_DEPLOYMENT: z.string().default(DEFAULT_MODEL),
    AZURE_OPENAI_API_VERSION: optionalSetting,
  }),
]);

/** The settings from `env`, with `ADAPTER` defaulting to the hosts' default backend. */
export function parseProviderEnv(env: Record<string, string | undefined>) {
  return providerEnvSchema.parse({ ...env, ADAPTER: env.ADAPTER ?? DEFAULT_ADAPTER });
}

/**
 * What `npm run serve` reads from the environment: where to listen and the token every request
 * must carry. It listens on 127.0.0.1 unless `SERVER_HOST` says otherwise (the server runs
 * commands for whoever reaches it), and generates a token when `SERVER_TOKEN` is unset.
 * `SERVER_PORT=0` picks a free port, as a UI that starts its own backend asks for.
 */
const serverEnvSchema = z.object({
  SERVER_HOST: optionalSetting.pipe(z.string().min(1).default(SERVER.host)),
  SERVER_PORT: count(SERVER.port).pipe(z.number().max(65_535)),
  SERVER_TOKEN: optionalSetting.pipe(
    z.string().min(32, 'Set SERVER_TOKEN to at least 32 characters, or leave it unset').optional(),
  ),
});

/** The server settings from `env`. */
export function parseServerEnv(env: Record<string, string | undefined>) {
  const parsed = serverEnvSchema.parse(env);

  return { host: parsed.SERVER_HOST, port: parsed.SERVER_PORT, token: parsed.SERVER_TOKEN };
}

/**
 * How the backend runs each conversation, from its environment: `MAX_TURNS`, `WAIT_FOR_TASKS`
 * (a prompt's `done` waits for its background tasks, as a one-shot run wants), `MODEL_CALLS_FILE`
 * (each model call's full request appended there, one JSON line each) and `SERVER_EXIT_WITH_PARENT`
 * (stop when stdin closes: the UI that started it is gone).
 */
const runEnvSchema = z.object({
  MAX_TURNS: count(MAX_TURNS).pipe(z.number().min(1)),
  WAIT_FOR_TASKS: optionalSetting,
  MODEL_CALLS_FILE: optionalSetting,
  SERVER_EXIT_WITH_PARENT: optionalSetting,
});

/** The run settings from `env`. Only the exact string "true" turns a switch on. */
export function parseRunEnv(env: Record<string, string | undefined>) {
  const parsed = runEnvSchema.parse(env);

  return {
    maxTurns: parsed.MAX_TURNS,
    waitForTasks: parsed.WAIT_FOR_TASKS === 'true',
    modelCallsFile: parsed.MODEL_CALLS_FILE,
    exitWithParent: parsed.SERVER_EXIT_WITH_PARENT === 'true',
  };
}

/**
 * What both terminal CLIs (the demo and the chat) read from their command line and environment:
 * `--trust`, the prompt (the other arguments, or empty), and the settings that shape a run.
 */
export function parseCliSettings(params: {
  env: Record<string, string | undefined>;
  args: readonly string[];
}) {
  const { env, args } = params;

  return {
    /** `--trust`: trust this workspace's `.sheavly/` hooks (remembered until `.sheavly/` changes). */
    trustWorkspace: args.includes('--trust'),
    prompt: args.filter((arg) => arg !== '--trust').join(' '),
    workspaceRoot: optionalSetting.pipe(z.string().min(1).optional()).parse(env.WORKSPACE_ROOT),
    /** Only the exact string "true" turns these on. */
    skipAllowList: env.RUN_COMMAND_SKIP_ALLOW_LIST === 'true',
    showModelCalls: env.SHOW_MODEL_CALLS === 'true',
  };
}
