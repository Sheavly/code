import type { CommandPermissions } from '@sheavly/coding/run-command/run-command.types';
import type { PermissionStore } from '@sheavly/storage/permission-store/permission-store.service';

/**
 * What the user lets `run_command` do in one folder, as the store keeps it: read from the file on
 * every command, never cached, so a mode set while a conversation runs applies from its next
 * command, as it does to every other conversation in the folder. `workspace` is the folder's real
 * path (symlinks followed), which is what its permissions file is named by.
 */
export function workspacePermissions(params: {
  store: PermissionStore;
  workspace: string;
}): CommandPermissions {
  const { store, workspace } = params;

  return {
    read: () => store.read(workspace),
    allow: (entry) => store.allow({ realPath: workspace, entry }),
  };
}
