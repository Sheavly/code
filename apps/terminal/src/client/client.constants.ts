/** How long a backend the terminal started may take to say it listens. */
export const BACKEND_READY_MS = 30_000;

/** The line a backend prints once it listens: `→ listening on <url>`. */
export const LISTENING_LINE = /^→ listening on (\S+)$/m;

/**
 * How many ended task ids a conversation remembers, so an entry the prompt's stream and the live
 * feed both carry counts once. Far beyond how far apart the two streams can run; past it the
 * oldest id is forgotten, so a start for it that arrives that late would count again.
 */
export const ENDED_TASKS_KEPT = 1000;

/** The workspace whose `serve` script the terminal runs to start a backend. */
export const BACKEND_PACKAGE = '@sheavly/backend';
