import type { ProcessRunner } from '@sheavly/workspace/process/process.service';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';

/** What the tools that run ripgrep need. `ripgrepPath` defaults to the binary `@vscode/ripgrep` ships. */
export type RipgrepToolDeps = {
  workspace: Workspace;
  /** Where a search starts when the agent chose a working root. Default: the workspace root. */
  workingRoots?: WorkingRoots | undefined;
  processes: ProcessRunner;
  ripgrepPath?: string;
};

/** What one ripgrep run produced. `cut` means it was stopped for printing too much. */
export type RipgrepRun = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  cut: boolean;
  timedOut: boolean;
};
