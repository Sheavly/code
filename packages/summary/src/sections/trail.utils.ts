import { summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { mergeEntries } from './entries.utils.js';
import { TRAIL_MAX_CHARS } from './sections.constants.js';
import type { RuleSection, TrailExtractor } from './sections.types.js';

/**
 * A trail of what the work touched, in the order it happened, one short line per tool call the
 * `extract` function keeps. It is written by rules, not by a model: the trail is the weakest part
 * of every model summary, and a call's arguments are exact where a paraphrase is not. Which
 * calls matter, and how to say them, is the app's to decide (it knows what its tools do); this
 * package never learns what a file is. A call whose result is an error (refused, denied, failed)
 * is left out, since the trail says what was done and that call did not do it. Without anything
 * to say the section is left out.
 */
export function trailSection(params: { extract: TrailExtractor; maxChars?: number }): RuleSection {
  const { extract, maxChars = TRAIL_MAX_CHARS } = params;

  return {
    id: summarySectionIdSchema.parse('trail'),
    title: 'What was done',
    write: ({ messages, previous }) => {
      // A cut never splits a call from its result, so a call's result is in the same span.
      const failed = new Set(
        messages.flatMap((message) =>
          message.role === 'tool' && message.isError ? [message.toolCallId] : [],
        ),
      );
      const added = messages.flatMap((message) =>
        message.role === 'assistant'
          ? message.toolCalls.flatMap((call) => (failed.has(call.id) ? [] : (extract(call) ?? [])))
          : [],
      );

      return mergeEntries({ previous, added, maxChars });
    },
  };
}
