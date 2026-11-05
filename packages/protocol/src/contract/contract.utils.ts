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
  conversationDetailsSchema,
  conversationIdSchema,
  conversationSummarySchema,
  conversationsResponseSchema,
  messagesResponseSchema,
  modelChoiceSchema,
  sendPromptRequestSchema,
  serverErrorCodeSchema,
  serverErrorSchema,
  skillsResponseSchema,
  skillsQuerySchema,
  startConversationRequestSchema,
  startConversationResponseSchema,
  streamQuerySchema,
  switchModelRequestSchema,
} from '../server/server.validator.js';
import { skillInfoSchema, skillNameSchema, skillScopeSchema } from '../skill/skill.validator.js';
import {
  adaptersResponseSchema,
  bindWorkspaceRequestSchema,
  credentialStateSchema,
  modelsQuerySchema,
  modelsResponseSchema,
  profileSetupSchema,
  putCredentialRequestSchema,
  putModelRequestSchema,
  putProfileRequestSchema,
  setDefaultProfileRequestSchema,
  setupModelSchema,
  setupSchema,
  trustedWorkspaceSchema,
  trustedWorkspacesQuerySchema,
  trustedWorkspacesResponseSchema,
  workspaceProfileSchema,
  workspaceRequestSchema,
} from '../setup/setup.validator.js';
import {
  storedConversationSchema,
  storedConversationsQuerySchema,
  storedConversationsResponseSchema,
} from '../store/store.validator.js';
import {
  adapterDescriptionSchema,
  adapterKindSchema,
  keyCheckSchema,
  modelFileSchema,
  modelIdSchema,
  modelSchema,
} from '../model/model.validator.js';
import { streamEntrySchema } from '../stream/stream.validator.js';
import {
  taskIdSchema,
  taskInfoSchema,
  taskStatusSchema,
  taskUpdateSchema,
} from '../task/task.validator.js';
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
    TaskUpdate: taskUpdateSchema,
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
    ModelChoice: modelChoiceSchema,
    ConversationDetails: conversationDetailsSchema,
    SwitchModelRequest: switchModelRequestSchema,
    SendPromptRequest: sendPromptRequestSchema,
    StreamQuery: streamQuerySchema,
    AnswerApprovalRequest: answerApprovalRequestSchema,
    MessagesResponse: messagesResponseSchema,
    SkillsResponse: skillsResponseSchema,
    SkillsQuery: skillsQuerySchema,
    ServerErrorCode: serverErrorCodeSchema,
    ServerError: serverErrorSchema,
    SessionId: sessionIdSchema,
    CallId: callIdSchema,
    TaskId: taskIdSchema,
    ApprovalId: approvalIdSchema,
    ConversationId: conversationIdSchema,
    StoredConversation: storedConversationSchema,
    StoredConversationsQuery: storedConversationsQuerySchema,
    StoredConversationsResponse: storedConversationsResponseSchema,
    ModelId: modelIdSchema,
    AdapterKind: adapterKindSchema,
    ModelFile: modelFileSchema,
    Model: modelSchema,
    AdapterDescription: adapterDescriptionSchema,
    KeyCheck: keyCheckSchema,
    CredentialState: credentialStateSchema,
    SetupModel: setupModelSchema,
    ProfileSetup: profileSetupSchema,
    Setup: setupSchema,
    AdaptersResponse: adaptersResponseSchema,
    ModelsQuery: modelsQuerySchema,
    ModelsResponse: modelsResponseSchema,
    PutProfileRequest: putProfileRequestSchema,
    PutModelRequest: putModelRequestSchema,
    PutCredentialRequest: putCredentialRequestSchema,
    SetDefaultProfileRequest: setDefaultProfileRequestSchema,
    WorkspaceRequest: workspaceRequestSchema,
    BindWorkspaceRequest: bindWorkspaceRequestSchema,
    WorkspaceProfile: workspaceProfileSchema,
    TrustedWorkspace: trustedWorkspaceSchema,
    TrustedWorkspacesQuery: trustedWorkspacesQuerySchema,
    TrustedWorkspacesResponse: trustedWorkspacesResponseSchema,
  };
}

/**
 * Every schema of the contract as JSON Schema, by name, each referencing the others as
 * `${prefix}${name}`: `#/$defs/` in the contract's own document, `#/components/schemas/` in
 * the API's OpenAPI document.
 *
 * It describes what the schemas accept (`io: 'input'`): objects stay open, since parsing drops
 * unknown fields rather than rejecting them, and `AgentEvent` (`seq` with an event body, an
 * `allOf`) is only satisfiable when neither side forbids the other's fields.
 */
export function contractDefinitions(prefix: string): ContractJsonSchema['$defs'] {
  const registry = z.registry<{ id: string }>();

  for (const [id, schema] of Object.entries(contractSchemas())) registry.add(schema, { id });

  const { schemas } = z.toJSONSchema(registry, { uri: (id) => `${prefix}${id}`, io: 'input' });
  const definitions = Object.entries(schemas).map(([id, definition]) => {
    const { $schema: _dialect, $id: _id, ...rest } = definition;

    return [id, rest] as const;
  });

  return Object.fromEntries(definitions);
}

/** The name the contract gives `schema`, for a `$ref` to it; undefined when it isn't one. */
export function contractName(schema: z.ZodType): string | undefined {
  return Object.entries(contractSchemas()).find(([, candidate]) => candidate === schema)?.[0];
}

/**
 * The whole contract as one JSON Schema document (draft 2020-12), every type under `$defs` by
 * name and referencing the others with `$ref`, for clients that aren't TypeScript.
 */
export function contractJsonSchema(): ContractJsonSchema {
  return { $schema: JSON_SCHEMA_DIALECT, $defs: contractDefinitions('#/$defs/') };
}
