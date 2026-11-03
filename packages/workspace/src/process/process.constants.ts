/** Output kept per process; anything past this is dropped (the tail is what callers stream). */
export const MAX_OUTPUT_CHARS = 30_000;

/** Env vars that look like secrets are not passed to commands. */
export const SECRET_ENV = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;
