import { SetupError } from '../errors/setup.errors.js';

/**
 * Throws a `SetupError` (`forbidden`) unless this backend may hand out access over a network.
 * `refuses` finishes the sentence "This backend listens beyond this machine, so it …" and says
 * what it will not do there (a key, a trust, a looser permission), so the message names the one
 * thing the caller asked for.
 */
export function assertRemoteSetupAllowed(params: { allowed: boolean; refuses: string }): void {
  if (params.allowed) return;

  throw new SetupError({
    reason: 'forbidden',
    message: `This backend listens beyond this machine, so it ${params.refuses}. Listen on 127.0.0.1, or set SERVER_ALLOW_REMOTE_SETUP=true behind TLS.`,
  });
}
