// What the terminal app picks for a run. The packages have no defaults of their own: the UI says
// which backend and model a run uses, how long it may go on, and where trust is remembered.

/** Model calls per session (main and each sub-agent): room for multi-step sub-agent work. */
export const MAX_TURNS = 20;

/**
 * How a model call is sent, unless the environment says otherwise: wait a minute for the response
 * to start (a reply then streams for as long as it takes), and retry twice before anything
 * streamed, 1s then 2s apart. A provider that stalls costs a minute, not Node's five.
 */
export const REQUEST = { responseTimeoutMs: 60_000, retries: 2, retryDelayMs: 1000 } as const;

/** The backend and model when the environment names none. */
export const DEFAULT_ADAPTER = 'openai';
export const DEFAULT_MODEL = 'gpt-6.1-sol';

/** The trust store's file under the user's config folder (`$XDG_CONFIG_HOME` or `~/.config`). */
export const TRUST_STORE_PATH = ['sheavly', 'trusted-workspaces.json'];
