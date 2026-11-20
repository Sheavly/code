import os from 'node:os';
import path from 'node:path';
import type { Environment } from '@sheavly/core/environment/environment.types';

/**
 * The folder the user's profiles, models, conversations and trust live in: `SHEAVLY_HOME`, else
 * `.sheavly` in the user's home (`os.homedir()`, which Windows has and `HOME` does not). The
 * variable is for a test or a second install, never for a key: those are in the profile.
 */
export function sheavlyHome(env: Environment): string {
  // An empty variable (a blank line in a shell profile) counts as not set.
  const set = env.SHEAVLY_HOME === '' ? undefined : env.SHEAVLY_HOME;

  return set ?? path.join(os.homedir(), '.sheavly');
}
