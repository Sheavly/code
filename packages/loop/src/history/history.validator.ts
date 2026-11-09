import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { messageSchema } from '@sheavly/protocol/message/message.validator';
import type { Message } from '@sheavly/protocol/message/message.types';
import { InvalidHistoryError } from '../errors/loop.errors.js';

const messagesSchema = messageSchema.array();

/**
 * Turns what a `beforeModelCall` hook returned into messages, or throws an `InvalidHistoryError`
 * naming `source`. A project hook is plain JavaScript, so nothing about its result is typed: this
 * is where a `null`, an unknown role or an assistant message without `toolCalls` is refused, and
 * the messages come back as new objects the hook holds no reference to.
 */
export function parseSentMessages(params: { input: unknown; source: string }): Message[] {
  const { input, source } = params;

  return parseOrThrow({
    schema: messagesSchema,
    input,
    onInvalid: ({ details, error }) =>
      new InvalidHistoryError({
        source,
        problem: `the result is not a list of messages\n${details}`,
        cause: error,
      }),
  });
}
