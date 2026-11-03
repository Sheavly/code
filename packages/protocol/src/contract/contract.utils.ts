import { z } from 'zod';
import {
  approvalConcernSchema,
  approvalIdSchema,
  approvalOptionSchema,
  approvalRequestSchema,
  approvalResponseSchema,
  approvalUpdateSchema,
} from '../approval/approval.validator.js';
import {
  agentEventBodySchema,
  agentEventSchema,
  describedCallSchema,
  doneReasonSchema,
  entryEventSchema,
  toolArtifactSchema,
} from '../event/event.validator.js';
import {
  callIdSchema,
  messageSchema,
  promptPartSchema,
  reasoningItemSchema,
  toolCallSchema,
  turnStopReasonSchema,
} from '../message/message.validator.js';
import {
  inboxMessageSchema,
  runOutcomeSchema,
  sessionIdSchema,
  sessionInfoSchema,
  sessionRefSchema,
  sessionStateSchema,
  sessionUpdateSchema,
} from '../session/session.validator.js';
import {
  answerApprovalRequestSchema,
  conversationIdSchema,
  conversationSummarySchema,
  conversationsResponseSchema,
  messagesResponseSchema,
  sendPromptRequestSchema,
  serverErrorCodeSchema,
  serverErrorSchema,
  skillsResponseSchema,
  startConversationRequestSchema,
  startConversationResponseSchema,
  streamQuerySchema,
} from '../server/server.validator.js';
import { skillInfoSchema, skillNameSchema, skillScopeSchema } from '../skill/skill.validator.js';
import { streamEntrySchema } from '../stream/stream.validator.js';
import { taskIdSchema, taskInfoSchema, taskStatusSchema } from '../task/task.validator.js';
import type { ContractJsonSchema } from './contract.types.js';

const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** Every schema of the contract, by the name its TypeScript type has. */
function contractSchemas(): Record<string, z.ZodType> {
  return {
    AgentEvent: agentEventSchema,
    AgentEventBody: agentEventBodySchema,
    EntryEvent: entryEventSchema,
    DescribedCall: describedCallSchema,
    DoneReason: doneReasonSchema,
    ToolArtifact: toolArtifactSchema,
    Message: messageSchema,
    PromptPart: promptPartSchema,
    ToolCall: toolCallSchema,
    ReasoningItem: reasoningItemSchema,
    TurnStopReason: turnStopReasonSchema,
    SessionRef: sessionRefSchema,
    SessionState: sessionStateSchema,
    RunOutcome: runOutcomeSchema,
    SessionInfo: sessionInfoSchema,
    InboxMessage: inboxMessageSchema,
    SessionUpdate: sessionUpdateSchema,
    StreamEntry: streamEntrySchema,
    TaskStatus: taskStatusSchema,
    TaskInfo: taskInfoSchema,
    ApprovalConcern: approvalConcernSchema,
    ApprovalOption: approvalOptionSchema,
    ApprovalRequest: approvalRequestSchema,
    ApprovalResponse: approvalResponseSchema,
    ApprovalUpdate: approvalUpdateSchema,
    SkillName: skillNameSchema,
    SkillScope: skillScopeSchema,
    SkillInfo: skillInfoSchema,
    StartConversationRequest: startConversationRequestSchema,
    StartConversationResponse: startConversationResponseSchema,
    ConversationSummary: conversationSummarySchema,
    ConversationsResponse: conversationsResponseSchema,
    SendPromptRequest: sendPromptRequestSchema,
    StreamQuery: streamQuerySchema,
    AnswerApprovalRequest: answerApprovalRequestSchema,
    MessagesResponse: messagesResponseSchema,
    SkillsResponse: skillsResponseSchema,
    ServerErrorCode: serverErrorCodeSchema,
    ServerError: serverErrorSchema,
    SessionId: sessionIdSchema,
    CallId: callIdSchema,
    TaskId: taskIdSchema,
    ApprovalId: approvalIdSchema,
    ConversationId: conversationIdSchema,
  };
}

/**
 * The whole contract as one JSON Schema document (draft 2020-12), every type under `$defs` by
 * name and referencing the others with `$ref`, for clients that aren't TypeScript.
 *
 * It describes what the schemas accept (`io: 'input'`): objects stay open, since parsing drops
 * unknown fields rather than rejecting them, and `AgentEvent` (`seq` with an event body, an
 * `allOf`) is only satisfiable when neither side forbids the other's fields.
 */
export function contractJsonSchema(): ContractJsonSchema {
  const registry = z.registry<{ id: string }>();

  for (const [id, schema] of Object.entries(contractSchemas())) registry.add(schema, { id });

  const { schemas } = z.toJSONSchema(registry, { uri: (id) => `#/$defs/${id}`, io: 'input' });
  const definitions = Object.entries(schemas).map(([id, definition]) => {
    const { $schema: _dialect, $id: _id, ...rest } = definition;

    return [id, rest] as const;
  });

  return { $schema: JSON_SCHEMA_DIALECT, $defs: Object.fromEntries(definitions) };
}
