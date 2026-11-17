import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';

/** One AGENTS.md that was found: where it is (relative to the root) and what it says. */
export type AgentsFile = {
  path: string;
  content: string;
};

export type AgentsMdHookOptions = {
  /**
   * The conversation's working root, read each turn. When set, it replaces `cwd`: inside `root`,
   * files from `root` down to it apply; outside (a sibling worktree), it is the project root.
   */
  workingRoots?: Pick<WorkingRoots, 'root'>;
  /** The project root: discovery never goes above it. Usually the workspace root. */
  root: string;
  /** Where the agent works; defaults to `root`. Files from `root` down to here apply. */
  cwd?: string;
};
