/**
 * Why the run's lifetime signal was aborted when the system prompt could not be composed. It is
 * what an extension reads as `signal.reason`, so it says only that composing failed and carries no
 * cause: the real error names the app's omitted name and every contributed section, and only the
 * caller of the run gets it.
 */
export class SystemPromptFailedAbort extends Error {
  override name = 'SystemPromptFailedAbort';

  constructor() {
    super('The run failed while its system prompt was composed');
  }
}
