import { z } from 'zod';
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
  /** The model it ran on last, by the name a UI switches with. */
  model: z.string(),
  status: storedStatusSchema,
  /** When it started. */
  startedAt: timestampSchema,
  /** When its last entry was written. */
  updatedAt: timestampSchema,
});
