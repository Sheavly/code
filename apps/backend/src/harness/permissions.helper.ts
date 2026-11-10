import type { Environment } from '@sheavly/core/environment/environment.types';
import type { CommandPermissions } from '@sheavly/coding/run-command/run-command.types';
import type { PermissionStore } from '@sheavly/storage/permission-store/permission-store.service';
import { ConversationPermissions } from './conversation-permissions.service.js';

/**
 * What the user lets `run_command` do in one folder, as the store keeps it: read from the file on
 * every command, never cached, so a mode set while a conversation runs applies from its next
 * command, as it does to every other conversation in the folder. `workspace` is the folder's real
 * path (symlinks followed); its permissions file is named by the same folder in the repo's main
 * worktree, so every worktree of a repo shares one mode and allow list.
 */
export function workspacePermissions(params: {
  store: PermissionStore;
  workspace: string;
  env: Environment;
}): CommandPermissions {
  const { store, workspace, env } = params;

  return new ConversationPermissions({ store, workspace, env });
}
