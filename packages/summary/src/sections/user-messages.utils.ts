import type { Message } from '@sheavly/protocol/message/message.types';
import { mergeEntries } from './entries.utils.js';
import {
  USER_MESSAGE_MAX_CHARS,
  USER_MESSAGES_MAX_CHARS,
  USER_OPENING_MAX_CHARS,
} from './sections.constants.js';
import type { RuleSection } from './sections.types.js';

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
 *
 * The conversation's first message is kept for good and cut later than the rest: the rules a
 * person sets usually come first, and a summary must not drop them as the chat grows. When the
 * section is full, the messages between that opening and the newest go instead. Which messages
 * are rules is not for code to guess, so nothing else is pinned.
 */
export function userMessagesSection(
  options: {
    include?: (message: Extract<Message, { role: 'user' }>) => boolean;
    title?: string;
    maxChars?: number;
    maxMessageChars?: number;
    maxOpeningChars?: number;
  } = {},
): RuleSection {
  const {
    include = (message) => message.id !== undefined,
    title = 'What the user asked for',
    maxChars = USER_MESSAGES_MAX_CHARS,
    maxMessageChars = USER_MESSAGE_MAX_CHARS,
    maxOpeningChars = USER_OPENING_MAX_CHARS,
  } = options;

  return {
    id: 'user-messages',
    title,
    write: ({ messages, previous }) => {
      // With no earlier entries the first message written here is the conversation's opening.
      let opening = !previous;
      const added = messages.flatMap((message) => {
        if (message.role !== 'user' || !include(message)) return [];

        const text = message.content.trim();

        if (!text) return [];

        const limit = opening ? maxOpeningChars : maxMessageChars;

        opening = false;

        return [text.length > limit ? `${text.slice(0, limit - 1)}…` : text];
      });

      return mergeEntries({ previous, added, maxChars, pin: 1 });
    },
  };
}
