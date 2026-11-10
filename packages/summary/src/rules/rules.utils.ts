import type { Summarizer } from '@sheavly/core/summary/summary.types';
import { summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { assertSectionIds } from '../sections/definition.utils.js';
import type { RuleSection } from '../sections/sections.types.js';

/**
 * A summarizer with no model and no cost: each section is written by its rule from the span and
 * from the same section in the previous checkpoint. With the user's own messages and a trail it
 * is a sliding window that still remembers what was asked and what was touched; with only
 * `windowSection` it says how much is gone and nothing more.
 *
 * A section that writes nothing is left out, so the checkpoint holds only what there is to say.
 * Throws a `SummaryDefinitionError` for no sections or a repeated section id.
 */
export function rulesSummarizer(params: {
  name?: string;
  sections: readonly RuleSection[];
}): Summarizer {
  const { name = 'rules', sections } = params;

  assertSectionIds({ summarizer: name, ids: sections.map((section) => section.id) });

  // Parsed once here, so a code past this point trusts the branded id.
  const branded = sections.map((section) => ({
    section,
    id: summarySectionIdSchema.parse(section.id),
  }));

  return {
    name,
    summarize: async ({ messages, previous }) => ({
      sections: branded.flatMap(({ section, id }) => {
        const before = previous?.sections.find((candidate) => candidate.id === id);
        const body = section.write({ messages, previous: before?.body });

        return body ? [{ id, title: section.title, body }] : [];
      }),
    }),
  };
}
