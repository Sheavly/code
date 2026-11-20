import path from 'node:path';
import type { Environment } from '@sheavly/core/environment/environment.types';
import { DocumentFile } from '@sheavly/storage/document-file/document-file.service';
import { sheavlyHome } from '@sheavly/storage/home/home.helper';
import { PermissionStore } from '@sheavly/storage/permission-store/permission-store.service';
import { TrustStore } from '@sheavly/coding/trust/trust.service';
import { TRUSTED_WORKSPACES_FILE } from './profiles.constants.js';

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

/**
 * What the user lets `run_command` do in each of their folders, kept in `permissions/` in their
 * folder: shared by every profile and every conversation, and read fresh by each command, so a
 * change applies to the conversations already running.
 */
export function permissionStoreFor(env: Environment): PermissionStore {
  return new PermissionStore({ root: sheavlyHome(env) });
}
