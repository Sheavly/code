import { findOutputRefs } from '@sheavly/protocol/output/output.utils';
import { mergeEntries } from './entries.utils.js';
import { OUTPUT_REFS_MAX_CHARS, OUTPUT_REF_LABEL_CHARS } from './sections.constants.js';
import type { RuleSection } from './sections.types.js';

/**
 * The `output_ref`s of command output the model was shown, each with the command line of the
 * result it came from. A checkpoint replaces those results, and the reference is the only way back
 * to the complete output without rerunning the command, so it is carried by a rule, not left to a
 * model's paraphrase. The oldest are dropped first past `maxChars`. Without any, the section is
 * left out.
 */
export function outputRefsSection(options: { maxChars?: number } = {}): RuleSection {
  const { maxChars = OUTPUT_REFS_MAX_CHARS } = options;

  return {
    id: 'output-refs',
    title: 'Stored command output (read with read_output, search with search_output)',
    write: ({ messages, previous }) => {
      const added = messages.flatMap((message) => {
        if (message.role !== 'tool') return [];

        const [command = ''] = message.content.split('\n');

        return findOutputRefs(message.content).map((ref) =>
          `output_ref=${ref} ${command.slice(0, OUTPUT_REF_LABEL_CHARS)}`.trimEnd(),
        );
      });

      return mergeEntries({ previous, added, maxChars });
    },
  };
}
