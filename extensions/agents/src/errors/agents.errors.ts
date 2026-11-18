type SharedProblem = 'invalid' | 'duplicate' | 'reserved';

/**
 * An extension shared something sub-agents cannot use: an entry that is not an object with a name
 * (`invalid`), a name already shared or repeated in one call (`duplicate`), or the name of a tool
 * every sub-agent gets from the `agents` extension itself (`reserved`). Nothing from that call is
 * shared.
 */
export class SubAgentShareError extends Error {
  override name = 'SubAgentShareError';
  readonly problem: SharedProblem;

  constructor(params: { problem: SharedProblem; message: string }) {
    super(params.message);
    this.problem = params.problem;
  }
}
