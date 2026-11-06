import type { AllowEntry, Permissions } from '@sheavly/protocol/permission/permission.types';
import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import type { ProcessRunner } from '@sheavly/workspace/process/process.service';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';

/**
 * What the user lets `run_command` do in this folder, read fresh on every command so a change of
 * mode applies to every conversation running there from its next command. The app gives it the
 * user's stored permissions for the workspace; `coding` never knows where they live.
 */
export type CommandPermissions = {
  read(): Promise<Permissions>;
  /** Remembers `entry` for good (the user's "always allow"). Throws if it could not be kept. */
  allow(entry: AllowEntry): Promise<void>;
  /** Shares a grant with this conversation's agents, without persisting it. */
  allowSession?(entry: AllowEntry): Promise<void>;
};

export type RunCommandOptions = {
  workspace: Workspace;
  /** What the user allows here: see `CommandPermissions`. */
  permissions: CommandPermissions;
  /** Applies to foreground commands. Background tasks run until they exit or are cancelled. */
  timeoutMs?: number;
  /** Enables `background: true`. Without it, every command runs in the foreground. */
  tasks?: TaskRegistry;
  /**
   * Where an unapproved base command (or every command in always_ask) waits for the user's
   * answer. Without it, or with no one subscribed to it (a headless run), those commands are
   * refused.
   */
  approvals?: ApprovalRegistry | undefined;
  /**
   * Runs the commands and stops any still running when the process exits: pass the harness's
   * one runner, built from the environment the app passed in.
   */
  processes: ProcessRunner;
};
