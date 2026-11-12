import { SummaryDefinitionError } from '../errors/summary.errors.js';

/**
 * Throws a `SummaryDefinitionError` naming `summarizer` unless it has at least one section and
 * every id is used once. Both built-in summarizers call it when they are defined, so a mistake
 * fails at startup, not mid-run.
 */
export function assertSectionIds(params: {
  summarizer: string;
  ids: readonly string[];
  /** Each section's title, when the sections are told apart by it (a model's reply headings). */
  titles?: readonly string[];
}): void {
  const { summarizer, ids, titles = [] } = params;

  if (ids.length === 0) {
    throw new SummaryDefinitionError({ summarizer, problem: 'it has no sections' });
  }

  if (new Set(ids).size !== ids.length) {
    throw new SummaryDefinitionError({ summarizer, problem: 'two sections share an id' });
  }

  const lowered = titles.map((title) => title.trim().toLowerCase());

  if (new Set(lowered).size !== lowered.length) {
    throw new SummaryDefinitionError({ summarizer, problem: 'two sections share a title' });
  }

  // A heading is matched by title or id, so a title equal to another section's id is ambiguous.
  const ownIds = new Set(ids.map((id) => id.toLowerCase()));
  const clash = titles.some(
    (title, index) =>
      ownIds.has(title.trim().toLowerCase()) && ids[index]?.toLowerCase() !== lowered[index],
  );

  if (clash) {
    throw new SummaryDefinitionError({
      summarizer,
      problem: "a section's title is another section's id",
    });
  }
}
