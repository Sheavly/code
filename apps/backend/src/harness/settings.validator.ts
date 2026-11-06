import { z } from 'zod';
import { REQUEST, SERVER } from './harness.constants.js';

/** An empty setting (`SERVER_HOST=`) means "not set". */
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
 * How the backend sends a model call: `MODEL_RESPONSE_TIMEOUT_MS`, `MODEL_RETRIES` and
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
  /**
   * Only the exact string "true" lets the setup routes that hand out access (a model's key, a
   * workspace's trust) work over a network (put TLS in front).
   */
  SERVER_ALLOW_REMOTE_SETUP: optionalSetting,
});

/**
 * Whether `host` (a bind address) only this machine can reach: `localhost`, `::1` or any
 * `127.x.x.x`. `0.0.0.0` and `::` listen on every interface, so they are not.
 */
function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
}

/** The server settings from `env`. */
export function parseServerEnv(env: Record<string, string | undefined>) {
  const parsed = serverEnvSchema.parse(env);

  return {
    host: parsed.SERVER_HOST,
    port: parsed.SERVER_PORT,
    token: parsed.SERVER_TOKEN,
    /**
     * Whether the setup routes that hand out access (a model's key, a workspace's trust) may work:
     * on this machine, or opted into for a remote one.
     */
    remoteSetupAllowed:
      isLoopbackHost(parsed.SERVER_HOST) || parsed.SERVER_ALLOW_REMOTE_SETUP === 'true',
  };
}

/**
 * How the backend runs each conversation, from its environment: `MAX_TURNS` (no limit unless
 * set), `WAIT_FOR_TASKS` (a prompt's `done` waits for its background tasks, as a one-shot run
 * wants), `MODEL_CALLS_FILE` (each model call's full request appended there, one JSON line each)
 * and `SERVER_EXIT_WITH_PARENT` (stop when stdin closes: the UI that started it is gone).
 */
const runEnvSchema = z.object({
  MAX_TURNS: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : Number(value)))
    .pipe(z.number().int().min(1).optional()),
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
 * What the backend reads from its command line and environment: `--trust`, and the settings that
 * shape a run.
 */
export function parseCliSettings(params: {
  env: Record<string, string | undefined>;
  args: readonly string[];
}) {
  const { env, args } = params;

  return {
    /** `--trust`: trust this workspace's `.sheavly/` hooks (remembered until `.sheavly/` changes). */
    trustWorkspace: args.includes('--trust'),
    workspaceRoot: optionalSetting.pipe(z.string().min(1).optional()).parse(env.WORKSPACE_ROOT),
    /** Only the exact string "true" turns these on. */
    showModelCalls: env.SHOW_MODEL_CALLS === 'true',
  };
}
