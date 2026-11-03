import type { Environment } from '@sheavly/core/environment/environment.types';
import type { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';
import type { ProcessRunner } from '@sheavly/workspace/process/process.service';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import type { Harness, HarnessOptions } from '@sheavly/host/host/host.types';

export type CodingHarnessOptions = HarnessOptions & {
  /** The workspace root the agent is confined to (default: the current directory). */
  workspaceRoot?: string | undefined;
  /** The environment commands start from, secrets scrubbed (an app passes `process.env`). */
  env: Environment;
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
  fileLocks: FileLocks;
  /** Runs every command; each one it started is stopped when the process exits. */
  processes: ProcessRunner;
};
