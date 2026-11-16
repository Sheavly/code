import { z } from 'zod';
import { modelIdSchema, modelModeSchema } from '../model/model.validator.js';
import { profileIdSchema } from '../profile/profile.validator.js';
import { conversationIdSchema } from '../server/server.validator.js';
import { timestampSchema } from '../time/time.validator.js';

/**
 * Where a stored conversation stands. `open`: it was live when the index was last written.
 * `closed`: it ended on purpose. `interrupted`: it was `open` when its process died, and was
 * brought back from what had been written.
 */
const storedStatusSchema = z.enum(['open', 'closed', 'interrupted']);

/**
 * A stored conversation, as the store lists it: enough for a UI to show past chats and pick one
 * to reopen. Its entries are read separately, so listing stays cheap however long they are.
 */
export const storedConversationSchema = z.object({
  id: conversationIdSchema,
  title: z.string(),
  /** The model it ran on last, by its id; a name is a label and could be shared or renamed. */
  modelId: modelIdSchema,
  /** Restoring uses this, never the profile's newer selection. */
  mode: modelModeSchema,
  /** The folder it works in, as a real path, fixed when it started. */
  workspace: z.string(),
  /** The profile whose models and keys it runs on, fixed when it started. */
  profile: profileIdSchema,
  status: storedStatusSchema,
  /** When it started. */
  startedAt: timestampSchema,
  /** When its last entry was written. */
  updatedAt: timestampSchema,
});

/**
 * `QUERY /stored-conversations`: which kept conversations to list. Nothing: every one, of every
 * workspace and profile. `search`: those whose title has it, ignoring case, as a history's search
 * box narrows while the user types. `workspace` (a path) and `profile` keep only that folder's
 * or that profile's.
 */
export const storedConversationsQuerySchema = z.object({
  search: z.string().min(1).exactOptional(),
  workspace: z.string().min(1).exactOptional(),
  profile: profileIdSchema.exactOptional(),
});

/** `QUERY /stored-conversations`: the kept conversations, oldest first, live or not. */
export const storedConversationsResponseSchema = z.object({
  conversations: z.array(storedConversationSchema),
});
