import os from 'node:os';
import path from 'node:path';
import type { Environment } from '@sheavly/core/environment/environment.types';
import { DocumentFile } from '@sheavly/storage/document-file/document-file.service';
import { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { TRUSTED_WORKSPACES_FILE } from './profiles.constants.js';

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

/**
 * The user's workspace trust, kept in `trusted-workspaces.json` in their folder, outside every
 * repo so a repo can't trust itself. Shared by every profile: trust is about a repo, not a provider.
 * `SHEAVLY_TRUST_FILE` puts it elsewhere on its own, without moving their profiles: the workbook's
 * checks use a throwaway one so they never touch the user's trust, and still run on their models.
 */
export function trustStoreFor(env: Environment): TrustStore {
  // An empty variable counts as not set.
  const override = env.SHEAVLY_TRUST_FILE === '' ? undefined : env.SHEAVLY_TRUST_FILE;

  return new TrustStore({
    persistence: new DocumentFile({
      file: override ?? path.join(sheavlyHome(env), TRUSTED_WORKSPACES_FILE),
    }),
  });
}
