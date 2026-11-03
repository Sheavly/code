import type { z } from 'zod';
import type {
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
  startConversationResponseSchema,
  switchModelRequestSchema,
} from './server.validator.js';

/** A conversation's id on a server; not a session's id. */
export type ConversationId = z.infer<typeof conversationIdSchema>;

/** A live conversation, as another UI finds it to join. */
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/** A model a conversation can use. */
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

/** What a conversation's run is: workspace, model and the choices, trust, the allow list. */
export type ConversationDetails = z.infer<typeof conversationDetailsSchema>;

export type SwitchModelRequest = z.infer<typeof switchModelRequestSchema>;

/** What the user typed: `text` (`/<name>` mentions run skills) or `parts` (exactly those skills). */
export type SendPromptRequest = z.infer<typeof sendPromptRequestSchema>;

export type StartConversationResponse = z.infer<typeof startConversationResponseSchema>;

export type ConversationsResponse = z.infer<typeof conversationsResponseSchema>;

export type MessagesResponse = z.infer<typeof messagesResponseSchema>;

export type SkillsResponse = z.infer<typeof skillsResponseSchema>;

/** Which skills to list: all, or those a search matches. */
export type SkillsQuery = z.infer<typeof skillsQuerySchema>;

/** Why a request failed: one code per case a client handles differently. */
export type ServerErrorCode = z.infer<typeof serverErrorCodeSchema>;

/** Every failed request's body. */
export type ServerError = z.infer<typeof serverErrorSchema>;
