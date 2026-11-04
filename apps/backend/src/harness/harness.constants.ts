// What the backend picks for a run. The packages have no defaults of their own: the backend says
// how long a run may go on and how a model call is sent. Which model it uses is the user's, in
// their profile.

/** Model calls per session (main and each sub-agent): room for multi-step sub-agent work. */
export const MAX_TURNS = 20;

/**
 * How a model call is sent, unless the environment says otherwise: wait a minute for the response
 * to start (a reply then streams for as long as it takes), and retry twice before anything
 * streamed, 1s then 2s apart. A provider that stalls costs a minute, not Node's five.
 */
export const REQUEST = { responseTimeoutMs: 60_000, retries: 2, retryDelayMs: 1000 } as const;

/**
 * Where `npm run serve` listens when the environment says nothing: this machine only (the server
 * runs commands for whoever reaches it), on a port unlikely to be taken.
 */
export const SERVER = { host: '127.0.0.1', port: 4310 } as const;
