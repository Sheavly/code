import type { PermissionMode } from '@sheavly/protocol/permission/permission.types';

/** The user's workspace trust, in their folder (shared by every profile). */
export const TRUSTED_WORKSPACES_FILE = 'trusted-workspaces.json';

/** The mode that asks about every command: the only one a remote backend sets without leave. */
export const TIGHTEST_MODE: PermissionMode = 'always_ask';
