import { Hono } from 'hono';
import type { Conversations } from '@sheavly/host/conversations/conversations.service';
import { approvalIdSchema } from '@sheavly/protocol/approval/approval.validator';
import type {
  ConversationDetails,
  ConversationsResponse,
  MessagesResponse,
  SkillsResponse,
  StartConversationResponse,
  SwitchModelRequest,
} from '@sheavly/protocol/server/server.types';
import {
  answerApprovalRequestSchema,
  conversationIdSchema,
  startConversationRequestSchema,
  switchModelRequestSchema,
} from '@sheavly/protocol/server/server.validator';
import { validJson } from './server.validator.js';

/**
 * Listing, starting, describing, reading, steering and closing conversations: every route but the
 * two that stream. Each turns a request into one call on `conversations` and its result into JSON.
 */
export function conversationRoutes(conversations: Conversations) {
  return new Hono()
    .get('/', (c) =>
      c.json({ conversations: conversations.list() } satisfies ConversationsResponse),
    )
    .post('/', validJson(startConversationRequestSchema), async (c) => {
      const { messages } = c.req.valid('json');
      const id = await conversations.start({ messages });

      return c.json({ id } satisfies StartConversationResponse, 201);
    })
    .get('/:id', (c) =>
      c.json(
        conversations.details(
          conversationIdSchema.parse(c.req.param('id')),
        ) satisfies ConversationDetails,
      ),
    )
    .put('/:id/model', validJson(switchModelRequestSchema), (c) => {
      const { name }: SwitchModelRequest = c.req.valid('json');

      conversations.useModel({ id: conversationIdSchema.parse(c.req.param('id')), name });

      return c.body(null, 204);
    })
    .get('/:id/messages', (c) => {
      const id = conversationIdSchema.parse(c.req.param('id'));

      return c.json({ messages: [...conversations.messages(id)] } satisfies MessagesResponse);
    })
    .get('/:id/skills', async (c) => {
      const id = conversationIdSchema.parse(c.req.param('id'));
      const skills = await conversations.skills({ id, signal: c.req.raw.signal });

      return c.json({ skills } satisfies SkillsResponse);
    })
    .post('/:id/stop', (c) => {
      conversations.stop(conversationIdSchema.parse(c.req.param('id')));

      return c.body(null, 204);
    })
    .post('/:id/approvals/:approval', validJson(answerApprovalRequestSchema), (c) => {
      conversations.answer({
        id: conversationIdSchema.parse(c.req.param('id')),
        approval: approvalIdSchema.parse(c.req.param('approval')),
        response: c.req.valid('json').response,
      });

      return c.body(null, 204);
    })
    .delete('/:id', async (c) => {
      await conversations.close(conversationIdSchema.parse(c.req.param('id')));

      return c.body(null, 204);
    });
}
