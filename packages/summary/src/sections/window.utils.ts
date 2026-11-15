import { summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import type { RuleSection } from './sections.types.js';

/** The count in this section's one line, or zero when there is none to read. */
function countIn(text: string | undefined): number {
  const match = /^- (\d+) earlier messages? (?:is|are) no longer shown/.exec(text ?? '');

  return match?.[1] ? Number(match[1]) : 0;
}

/**
 * Says how much history is no longer shown, and that nothing summarized it: the honest part of a
 * sliding window. It keeps a rules-only checkpoint from ever being empty, and the count carries
 * across checkpoints, so the model can tell a long conversation from a short one.
 */
export const windowSection: RuleSection = {
  id: summarySectionIdSchema.parse('window'),
  title: 'Earlier history',
  write: ({ messages, previous }) => {
    const total = countIn(previous) + messages.length;

    if (total === 0) return '';

    return total === 1
      ? '- 1 earlier message is no longer shown.'
      : `- ${total} earlier messages are no longer shown.`;
  },
};
