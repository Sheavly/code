/**
 * A sub-agent's run ended without finishing (`reason` is how it stopped), so it has no report.
 * It fails the sub-agent's task, and the parent is told that and why.
 */
export class SubAgentStoppedError extends Error {
  override name = 'SubAgentStoppedError';

  readonly reason: string;

  constructor(params: { reason: string }) {
    super(`The sub-agent did not finish: it stopped (${params.reason}).`);
    this.reason = params.reason;
  }
}
