/**
 * The model's reply could not be turned into sections: it was not the JSON object asked for, or
 * it was empty. Thrown from `summarize`, so the loop reports it as a failed summary and carries
 * on. The message says what was wrong and never quotes the reply, which is model-written text
 * over material that may hold secrets or injected instructions.
 */
export class SummaryReplyError extends Error {
  override name = 'SummaryReplyError';
  /** The summarizer's name. */
  readonly summarizer: string;

  constructor(params: { summarizer: string; problem: string; cause?: unknown }) {
    const { summarizer, problem, cause } = params;

    super(`Summarizer ${summarizer}: the model's reply was unusable: ${problem}`, { cause });
    this.summarizer = summarizer;
  }
}

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
