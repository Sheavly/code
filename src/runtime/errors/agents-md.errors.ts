/** `cwd` is outside `root`, so there is no chain of AGENTS.md folders between them. */
export class AgentsMdError extends Error {
  override name = 'AgentsMdError';
  readonly root: string;
  readonly cwd: string;

  constructor(params: { root: string; cwd: string }) {
    const { root, cwd } = params;

    super(`AGENTS.md: the working directory ${cwd} is outside the project root ${root}`);
    this.root = root;
    this.cwd = cwd;
  }
}
