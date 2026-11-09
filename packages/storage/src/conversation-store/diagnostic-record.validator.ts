import { z } from 'zod';
import { errorDetailsSchema } from '@sheavly/protocol/event/event.validator';
import { messageIdSchema, callIdSchema } from '@sheavly/protocol/message/message.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { timestampSchema } from '@sheavly/protocol/time/time.validator';

export const diagnosticRecordSchema = z.object({
  type: z.enum(['run_failed', 'hook_failed', 'tool_failed']),
  at: timestampSchema,
  seq: z.number().int().nonnegative(),
  conversationId: conversationIdSchema.exactOptional(),
  sessionId: sessionIdSchema,
  messageId: messageIdSchema.exactOptional(),
  modelId: modelIdSchema.exactOptional(),
  error: z.string(),
  details: errorDetailsSchema.exactOptional(),
  toolCallId: callIdSchema.exactOptional(),
  toolName: z.string().exactOptional(),
  hook: z.string().exactOptional(),
  handler: z.string().exactOptional(),
});
