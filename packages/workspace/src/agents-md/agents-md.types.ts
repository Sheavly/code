/** One AGENTS.md that was found: where it is (relative to the root) and what it says. */
export type AgentsFile = {
  path: string;
  content: string;
};

export type AgentsMdHookOptions = {
  /** The project root: discovery never goes above it. Usually the workspace root. */
  root: string;
  /** Where the agent works; defaults to `root`. Files from `root` down to here apply. */
  cwd?: string;
};
