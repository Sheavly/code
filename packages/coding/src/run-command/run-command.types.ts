import type { OutputStore, OutputWriter } from '@sheavly/core/output/output.types';
import type { AllowEntry, Permissions } from '@sheavly/protocol/permission/permission.types';
import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import type { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import type { ProcessRunner } from '@sheavly/workspace/process/process.service';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
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

/** A capture that started, or the reason none did. The command runs either way. */
export type Capture = { writer: OutputWriter } | { unavailable: string } | undefined;

/** The tools that run a command line, each through the same checks and approval. */
export type CommandToolName = 'run_command' | 'start_service';

/** The options the steps before a command starts need: the same for every tool that runs one. */
export type CommandLaunchOptions = Pick<
  RunCommandOptions,
  'workspace' | 'workingRoots' | 'permissions' | 'approvals'
>;

export type RunCommandOptions = {
  workspace: Workspace;
  /** Where a command starts when the agent chose a working root. Default: the workspace root. */
  workingRoots?: WorkingRoots | undefined;
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
   * This conversation's complete-output store. With it every command's captured output is kept
   * whole and its result carries an `output_ref`; without it only the bounded preview exists.
   */
  outputs?: OutputStore | undefined;
  /**
   * Runs the commands and stops any still running when the process exits: pass the harness's
   * one runner, built from the environment the app passed in.
   */
  processes: ProcessRunner;
  /**
   * The harness's reads. A command can change or delete any file, so every read is forgotten when
   * a command ends and the next edit or delete needs a new `read_file`. A background task or
   * service forgets them when it exits, not while it runs.
   */
  fileReads: FileReads;
};
