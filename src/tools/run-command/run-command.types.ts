import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import type { ProcessRunner } from '../../runtime/process/process.service.js';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { Workspace } from '../../runtime/workspace/workspace.service.js';

export type RunCommandOptions = {
  workspace: Workspace;
  /** Commands the agent may run. See `allow-list.constants.ts` for the pattern format. */
  allowList?: readonly string[];
  /** Skip the allow list and run any command through a shell. Off by default. */
  skipAllowList?: boolean;
  /** Applies to foreground commands. Background tasks run until they exit or are cancelled. */
  timeoutMs?: number;
  /** Enables `background: true`. Without it, every command runs in the foreground. */
  tasks?: TaskRegistry;
  /**
   * Where allow-listed commands with risky arguments wait for the user's answer. Without it, or
   * with no one subscribed to it (a headless run), those commands are refused.
   */
  approvals?: ApprovalRegistry | undefined;
  /**
   * Runs the commands and stops any still running when the process exits: pass the harness's
   * one runner. Without one, the tool gets its own.
   */
  processes?: ProcessRunner;
};
