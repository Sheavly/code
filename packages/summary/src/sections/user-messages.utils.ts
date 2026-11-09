import type { Message } from '@sheavly/protocol/message/message.types';
import { mergeEntries } from './entries.utils.js';
import type { RuleSection } from './sections.types.js';

const DEFAULT_MAX_CHARS = 6_000;
const DEFAULT_MAX_MESSAGE_CHARS = 600;

/**
 * The user's own messages, word for word and in order: what they asked for is the one thing a
 * summary must not paraphrase. Each message is cut at `maxMessageChars` and the section at
 * `maxChars`, oldest dropped first, so it stays small however long the conversation runs.
 *
 * Only a message a person typed counts by default: the host gives those an `id`, and gives none
 * to what the harness adds as `user` messages (background task output, a parent agent's
 * steering, hook context). Command output reaches a task notice, so counting those would let
 * injected text pass for the user's words. An app that tells prompts apart another way passes
 * `include`, and one whose "user" is another agent (a sub-agent's task) passes `title`, so the
 * heading does not claim a person wrote it.
 */
export function userMessagesSection(
  options: {
    include?: (message: Extract<Message, { role: 'user' }>) => boolean;
    title?: string;
    maxChars?: number;
    maxMessageChars?: number;
  } = {},
): RuleSection {
  const {
    include = (message) => message.id !== undefined,
    title = 'What the user asked for',
    maxChars = DEFAULT_MAX_CHARS,
    maxMessageChars = DEFAULT_MAX_MESSAGE_CHARS,
  } = options;

  return {
    id: 'user-messages',
    title,
    write: ({ messages, previous }) => {
      const added = messages.flatMap((message) => {
        if (message.role !== 'user' || !include(message)) return [];

        const text = message.content.trim();

        if (!text) return [];

        return [text.length > maxMessageChars ? `${text.slice(0, maxMessageChars - 1)}…` : text];
      });

      return mergeEntries({ previous, added, maxChars });
    },
  };
}
