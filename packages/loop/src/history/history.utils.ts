import { isDeepStrictEqual } from 'node:util';
import { InvalidHistoryError } from '../errors/loop.errors.js';
import type { Message } from '@sheavly/protocol/message/message.types';
import { MAX_SHOWN_ID } from './history.constants.js';

/**
 * What a message is, for telling one from another without ids: a tool result by its call id, an
 * assistant message by the calls it made (or its text when it made none), a user message by its
 * text. So rewording a tool result is the same message edited, and rewording a user message is a
 * different one. A JSON tuple, so two kinds of message can never share a key.
 */
function identityOf(message: Message): string {
  if (message.role === 'tool') return JSON.stringify(['tool', message.toolCallId]);

  if (message.role === 'assistant' && message.toolCalls.length > 0) {
    return JSON.stringify(['assistant', message.toolCalls.map((call) => call.id)]);
  }

  return JSON.stringify([message.role, message.content]);
}

/**
 * What a hook did to the messages: `added` are in `after` and not in `before`, `removed` the
 * reverse, and `edited` are in both (by `identityOf`) but not equal. A reworded user message or
 * an assistant message without calls is a removal plus an addition, since nothing says which
 * message it replaced. Moving messages around is not reported.
 */
export function countChanges(params: { before: readonly Message[]; after: readonly Message[] }): {
  added: number;
  removed: number;
  edited: number;
} {
  const { before, after } = params;
  const unmatched = new Map<string, Message[]>();
  let added = 0;
  let edited = 0;

  for (const message of before) {
    const key = identityOf(message);

    unmatched.set(key, [...(unmatched.get(key) ?? []), message]);
  }

  for (const message of after) {
    const original = unmatched.get(identityOf(message))?.shift();

    if (!original) added += 1;
    else if (!isDeepStrictEqual(original, message)) edited += 1;
  }

  const removed = [...unmatched.values()].reduce((sum, left) => sum + left.length, 0);

  return { added, removed, edited };
}

/** A model call with no messages is rejected by every provider. */
function findEmptyProblem(messages: readonly Message[]): string | undefined {
  return messages.length === 0 ? 'there are no messages to send' : undefined;
}

/**
 * Every tool call needs its result right after the assistant message that made it, and a result
 * needs a call before it. Returns what is wrong, or undefined.
 */
function findPairingProblem(messages: readonly Message[]): string | undefined {
  let open = new Set<string>();

  for (const message of messages) {
    if (message.role === 'tool') {
      if (!open.delete(message.toolCallId)) {
        return `tool result ${shown(message.toolCallId)} has no tool call before it`;
      }

      continue;
    }

    const [unanswered] = open;

    if (unanswered !== undefined) {
      return `tool call ${shown(unanswered)} has no result before the next ${message.role} message`;
    }

    const ids = message.role === 'assistant' ? message.toolCalls.map((call) => call.id) : [];

    open = new Set(ids);
    if (open.size < ids.length) return 'an assistant message repeats a tool call id';
  }

  const [unanswered] = open;

  return unanswered === undefined ? undefined : `tool call ${shown(unanswered)} has no result`;
}

/** A call id is the model's (or a hook's) text: cut it short before it goes into an error. */
function shown(id: string): string {
  return id.length > MAX_SHOWN_ID ? `${id.slice(0, MAX_SHOWN_ID)}…` : id;
}

/** The last user message must be the one the model was about to answer, word for word. */
function findLatestUserProblem(params: {
  messages: readonly Message[];
  latestUser: Message | undefined;
}): string | undefined {
  const { messages, latestUser } = params;

  if (!latestUser) return undefined;

  const kept = messages.findLast((message) => message.role === 'user');

  if (kept && isDeepStrictEqual(kept, latestUser)) return undefined;

  return 'the latest user message was removed or changed';
}

/**
 * A request a person typed must still be shown word for word. A view may end with harness notices,
 * which a model is sent as `user` messages too, so the request is looked for anywhere in the
 * view rather than as its last `user` message.
 */
function findLatestRequestProblem(params: {
  messages: readonly Message[];
  latestRequest: Message | undefined;
}): string | undefined {
  const { messages, latestRequest } = params;

  if (!latestRequest) return undefined;

  const kept = messages.some((message) => isDeepStrictEqual(message, latestRequest));

  return kept ? undefined : 'the latest user message was removed or changed';
}

/**
 * Throws an `InvalidHistoryError` naming `source` when `messages` can't be sent to a model: a
 * tool call without its result (or the reverse), or a missing expectation. `latestUser` is the
 * last `user` message of the input and must be that message unchanged (for a hook, which sees
 * notices as user messages). `latestRequest` is the latest message a person typed in stored
 * history, which must still be in `messages` unchanged wherever notices fall after it (for a
 * checkpoint's view). One check for every place that builds the messages a model sees, so each
 * fails the same way.
 */
export function assertValidHistory(params: {
  messages: readonly Message[];
  latestUser?: Message | undefined;
  latestRequest?: Message | undefined;
  source: string;
}): void {
  const { messages, latestUser, latestRequest, source } = params;
  const problem =
    findEmptyProblem(messages) ??
    findPairingProblem(messages) ??
    findLatestUserProblem({ messages, latestUser }) ??
    findLatestRequestProblem({ messages, latestRequest });

  if (problem !== undefined) throw new InvalidHistoryError({ source, problem });
}
