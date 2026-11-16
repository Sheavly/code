import type { ReconnectPolicy } from '@sheavly/client/client/client.types';

/** How the terminal reaches a backend: its settings, the CLI arguments it passes on, its output. */
export type BackendOptions = {
  /** This run's environment: `BACKEND_URL`/`BACKEND_TOKEN`, or the settings a started one reads. */
  env: NodeJS.ProcessEnv;
  /** Passed to a backend it starts (`--trust`). */
  args?: readonly string[];
  /** A started backend's output (its notices, model calls), as it comes. */
  onOutput: (text: string) => void;
  /** Aborting while a backend starts stops it and rejects: Ctrl+C during startup. */
  signal?: AbortSignal;
};

/**
 * A backend the terminal talks to; `stop` ends it if the terminal started it: SIGTERM to its
 * process group, then SIGKILL after `timeoutMs`. Calling it again returns the same stop. `fetch`
 * reaches it (the global one when unset): another transport, or a server app in the same process.
 */
export type Backend = {
  url: string;
  token: string;
  stop: (options?: { timeoutMs?: number }) => Promise<void>;
  fetch?: typeof fetch;
  /** How its streams reconnect after a drop: the client's defaults unless a test says otherwise. */
  reconnect?: ReconnectPolicy;
};
