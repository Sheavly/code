/**
 * A summarizer is defined wrong (`rulesSummarizer`, `modelSummarizer`): no sections, or two
 * sections with one id. Thrown when it is defined, so it fails at startup, not mid-run.
 */
export class SummaryDefinitionError extends Error {
  override name = 'SummaryDefinitionError';
  /** The summarizer's name. */
  readonly summarizer: string;

  constructor(params: { summarizer: string; problem: string }) {
    const { summarizer, problem } = params;

    super(`Summarizer ${summarizer}: ${problem}`);
    this.summarizer = summarizer;
  }
}
