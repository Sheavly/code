import { SummaryDefinitionError } from '../errors/summary.errors.js';

/**
 * Throws a `SummaryDefinitionError` naming `summarizer` unless it has at least one section and
 * every id is used once. Both built-in summarizers call it when they are defined, so a mistake
 * fails at startup, not mid-run.
 */
export function assertSectionIds(params: { summarizer: string; ids: readonly string[] }): void {
  const { summarizer, ids } = params;

  if (ids.length === 0) {
    throw new SummaryDefinitionError({ summarizer, problem: 'it has no sections' });
  }

  if (new Set(ids).size !== ids.length) {
    throw new SummaryDefinitionError({ summarizer, problem: 'two sections share an id' });
  }
}
