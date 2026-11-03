/** How long a backend the terminal started may take to say it listens. */
export const BACKEND_READY_MS = 30_000;

/** The line a backend prints once it listens: `→ listening on <url>`. */
export const LISTENING_LINE = /^→ listening on (\S+)$/m;

/** The workspace whose `serve` script the terminal runs to start a backend. */
export const BACKEND_PACKAGE = '@sheavly/backend';
