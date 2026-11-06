/** Maximum returned preview size; original output still reaches pipes and output callbacks. */
export const MAX_OUTPUT_CHARS = 30_000;

/** Env vars that look like secrets are not passed to commands. */
export const SECRET_ENV = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;
