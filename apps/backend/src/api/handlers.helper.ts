import type { Context } from 'hono';
import { ConversationsError } from '@sheavly/host/errors/conversations.errors';
import type { Conversations } from '@sheavly/host/conversations/conversations.service';
import type { RouteBody } from '@sheavly/protocol/api/api.types';
import { approvalIdSchema } from '@sheavly/protocol/approval/approval.validator';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { errorMessage } from '@sheavly/runtime/errors/errors.utils';
import type { ApiHandlers, ConversationRouteName } from './api.types.js';
import { parseLastEventId } from './api.utils.js';
import { streamEntries } from './sse.helper.js';

/**
 * The conversation id in a route's path; routes without one (`/conversations`) never read it. An
 * id that isn't a conversation id's shape (a lowercase UUID) can name no conversation, so it
 * answers as one nothing has does: `not_found`, not an error of the server's.
 */
export function idOf(c: Context): ConversationId {
  const parsed = conversationIdSchema.safeParse(c.req.param('id'));

  if (!parsed.success) {
    throw new ConversationsError({
      reason: 'not_found',
      message: `No conversation ${c.req.param('id')}: a conversation id is a lowercase UUID`,
    });
  }

  return parsed.data;
}

/** Each conversation route's handler on `conversations`. */
export function apiHandlers(
  conversations: Conversations,
): Pick<ApiHandlers, ConversationRouteName> {
  return {
    listConversations: ({ c }) => c.json({ conversations: conversations.list() }),
    queryStoredConversations: async ({ c, body }) =>
      c.json({
        conversations: await conversations.listStored({
          search: body.search,
          workspace: body.workspace,
          profile: body.profile,
        }),
      }),
    reopenConversation: async ({ c, id }) => c.json({ id: await conversations.reopen(id) }),
    startConversation: async ({ c, body }) =>
      c.json(
        {
          id: await conversations.start({
            messages: body.messages,
            workspace: body.workspace,
            profile: body.profile,
          }),
        },
        201,
      ),
    getConversation: async ({ c, id }) => c.json(await conversations.details(id)),
    closeConversation: async ({ c, id }) => {
      await conversations.close(id);

      return c.body(null, 204);
    },
    switchModel: async ({ c, id, body }) => {
      await conversations.useModel({ id, modelId: body.id, ...(body.mode && { mode: body.mode }) });

      return c.body(null, 204);
    },
    getMessages: ({ c, id }) => c.json({ messages: [...conversations.messages(id)] }),
    querySkills: async ({ c, id, body }) =>
      c.json({
        skills: await conversations.skills({ id, search: body.search, signal: c.req.raw.signal }),
      }),
    sendPrompt: ({ c, id, body }) => sendPrompt({ c, id, body, conversations }),
    sendFollowup: async ({ c, id, body }) =>
      c.json({ accepted: await conversations.followup({ id, prompt: body }) }),
    stopPrompt: ({ c, id }) => {
      conversations.stop(id);

      return c.body(null, 204);
    },
    answerApproval: ({ c, id, body }) => {
      conversations.answer({
        id,
        approval: approvalIdSchema.parse(c.req.param('approval')),
        response: body.response,
      });

      return c.body(null, 204);
    },
    streamConversation: ({ c, id, body }) => {
      const lastEventId = parseLastEventId(c.req.header('last-event-id'));

      return streamEntries({
        c,
        live: conversations.get(id),
        filter: {
          ...(body.session !== undefined && { sessionId: body.session }),
          ...(body.subtree !== undefined && { subtree: body.subtree }),
          // Resuming needs the entries since the one the client got, which only replay has.
          replay: body.replay === true || lastEventId !== undefined,
        },
        lastEventId,
        answersApprovals: body.approvals === true,
      });
    },
  };
}

/**
 * Sends the next prompt and answers with its entries as server-sent events, ending with the main
 * session's `done`. A prompt that can't start (`session_running`, `unknown_skill`) is refused
 * before the stream opens. It runs to its end whether the client stays or not.
 */
async function sendPrompt(params: {
  c: Context;
  id: ConversationId;
  body: RouteBody<'sendPrompt'>;
  conversations: Conversations;
}): Promise<Response> {
  const { c, id, body, conversations } = params;
  const live = conversations.get(id);
  const { mainSession, sessions } = live.harness;
  // Sending resumes the session at once (its `session_resumed`); the response opens later, so
  // the first entry the prompt makes is recorded here and the response replays from it.
  let first: number | undefined;
  const stopRecording = sessions.subscribeEntries((entry) => (first ??= entry.seq));
  let sent: Awaited<ReturnType<Conversations['send']>>;

  try {
    // Validates and prepares it (skills), so a refusal is an error response, not a stream.
    sent = await conversations.send({ id, prompt: body });
  } finally {
    stopRecording();
  }

  return streamEntries({
    c,
    live,
    filter: { replay: first !== undefined },
    lastEventId: first === undefined ? undefined : first - 1,
    isLast: (entry) => endsMainRun({ entry, mainSessionId: mainSession.id }),
    // The run starts once the stream is listening, so none of its entries is missed; it is driven
    // here rather than by the response, so a client leaving doesn't stop it.
    onOpen: () => void drain(sent.events),
  });
}

/**
 * Whether `entry` ends the main session's run: its `done`, or, for a run that failed (which emits
 * no `done`), the update that leaves the session idle as `failed`.
 */
function endsMainRun(params: { entry: StreamEntry; mainSessionId: SessionId }): boolean {
  const { entry, mainSessionId } = params;

  if (entry.sessionId !== mainSessionId) return false;
  if (entry.kind === 'event') return entry.event.type === 'done';

  return (
    entry.kind === 'update' &&
    entry.update.type === 'session_idle' &&
    entry.update.session.lastOutcome === 'failed'
  );
}

/**
 * Runs a prompt to its end: its events reach clients through the combined stream. A failed run
 * throws here and nothing above awaits this, so it is caught: clients see the session go idle as
 * `failed`, the operator sees it on stderr, and an unhandled rejection doesn't stop the backend
 * and every other conversation with it.
 */
async function drain(events: AsyncIterable<unknown>): Promise<void> {
  try {
    for await (const _event of events);
  } catch (caughtError) {
    process.stderr.write(`prompt failed: ${errorMessage(caughtError)}\n`);
  }
}
