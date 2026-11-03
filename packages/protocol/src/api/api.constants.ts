import {
  answerApprovalRequestSchema,
  conversationDetailsSchema,
  conversationsResponseSchema,
  messagesResponseSchema,
  sendPromptRequestSchema,
  skillsResponseSchema,
  startConversationRequestSchema,
  startConversationResponseSchema,
  streamQuerySchema,
  switchModelRequestSchema,
} from '../server/server.validator.js';
import { streamEntrySchema } from '../stream/stream.validator.js';
import type { ApiRoute } from './api.types.js';

/** The API's OpenAPI document, committed at the package root (`npm run schema -w @sheavly/protocol`). */
export const OPENAPI_FILE = 'openapi.json';

/** Which OpenAPI version the document is: 3.2, the first with QUERY and stream item schemas. */
export const OPENAPI_VERSION = '3.2.0';

/** The `Last-Event-ID` header a stream resumes after: the last entry's `seq` a client got. */
export const LAST_EVENT_ID_HEADER = 'Last-Event-ID';

/**
 * The harness's HTTP API, by operation: every route a server implements and a client calls, with
 * the contract's schemas that validate its body and answer. The one definition of the API: the
 * server builds its routes from it, the OpenAPI document is written from it, and the client is
 * generated from that.
 */
export const API_ROUTES = {
  listConversations: {
    method: 'get',
    path: '/conversations',
    summary: 'Every live conversation, oldest first',
    response: { status: 200, schema: conversationsResponseSchema },
  },
  startConversation: {
    method: 'post',
    path: '/conversations',
    summary: 'Start a conversation, empty or continuing saved messages',
    body: startConversationRequestSchema,
    response: { status: 201, schema: startConversationResponseSchema },
  },
  getConversation: {
    method: 'get',
    path: '/conversations/{id}',
    summary: 'What the run is: workspace, models, trust, the allow list',
    response: { status: 200, schema: conversationDetailsSchema },
  },
  closeConversation: {
    method: 'delete',
    path: '/conversations/{id}',
    summary: 'Close it: its prompts, tasks and processes stop',
    response: { status: 204 },
  },
  switchModel: {
    method: 'put',
    path: '/conversations/{id}/model',
    summary: 'Switch to one of its models, from the next model call',
    body: switchModelRequestSchema,
    response: { status: 204 },
  },
  getMessages: {
    method: 'get',
    path: '/conversations/{id}/messages',
    summary: 'The history so far, valid to continue from',
    response: { status: 200, schema: messagesResponseSchema },
  },
  getSkills: {
    method: 'get',
    path: '/conversations/{id}/skills',
    summary: 'The skills a prompt can run, for a / menu',
    response: { status: 200, schema: skillsResponseSchema },
  },
  sendPrompt: {
    method: 'post',
    path: '/conversations/{id}/prompts',
    summary: "Send the next prompt; its entries stream back, to the main session's done",
    body: sendPromptRequestSchema,
    response: { status: 200, stream: streamEntrySchema },
  },
  stopPrompt: {
    method: 'post',
    path: '/conversations/{id}/stop',
    summary: 'Stop the running prompt; history stays valid',
    response: { status: 204 },
  },
  answerApproval: {
    method: 'post',
    path: '/conversations/{id}/approvals/{approval}',
    summary: 'Answer a waiting approval',
    body: answerApprovalRequestSchema,
    response: { status: 204 },
  },
  streamConversation: {
    method: 'query',
    path: '/conversations/{id}/stream',
    summary: 'Follow the whole conversation: every entry, filtered, while the client stays',
    body: streamQuerySchema,
    response: { status: 200, stream: streamEntrySchema },
  },
} as const satisfies Record<string, ApiRoute>;
