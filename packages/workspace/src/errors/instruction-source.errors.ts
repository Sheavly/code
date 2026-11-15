/** Two instruction sources were registered under one name, so one would shadow the other. */
export class InstructionSourceError extends Error {
  override name = 'InstructionSourceError';
  readonly source: string;

  constructor(params: { source: string }) {
    const { source } = params;

    super(`Instruction source "${source}" is registered twice`);
    this.source = source;
  }
}
