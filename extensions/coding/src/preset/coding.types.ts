import type { Environment } from '@sheavly/core/environment/environment.types';
import type { KeyedLocks } from '@sheavly/runtime/locks/keyed-locks.service';
import type { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import type { ProcessRunner } from '@sheavly/process/process/process.service';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import type { Harness, HarnessOptions } from '@sheavly/host/host/host.types';

export type CodingHarnessOptions = HarnessOptions & {
  /** The workspace root the agent is confined to (default: the current directory). */
  workspaceRoot?: string | undefined;
  /**
   * A shared scratch folder outside the repo that the file tools may also use. The app picks the
   * location (packages do not read env); it is created on open. Default: none.
   */
  scratchRoot?: string | undefined;
  /** The environment commands start from, secrets scrubbed (an app passes `process.env`). */
  env: Environment;
  /**
   * The locks every file tool of this run takes. Pass one set to every run of an app that has
   * several at once, so two runs editing one file take turns (they key by real path, so one set
   * serves any number of folders). Default: a set of this run's own.
   */
  fileLocks?: KeyedLocks | undefined;
};

/**
 * The services a coding run shares, on top of the generic ones: the workspace every file tool is
 * confined to, one set of file locks and one process runner. It holds no tools and no hooks: the
 * UI builds the file tools, `run_command`, the AGENTS.md hook and (if it trusts the workspace) the
 * `.sheavly/` hooks on these, and picks which ones a run gets.
 */
export type CodingHarness = Harness & {
  workspace: Workspace;
  /** Shared by every file tool, the main agent's and each sub-agent's, so edits never overlap. */
  fileLocks: KeyedLocks;
  /** Which files each agent has read, so `edit_file` refuses one an agent never saw. */
  fileReads: FileReads;
  /** Runs every command; each one it started is stopped when the process exits. */
  processes: ProcessRunner;
};
