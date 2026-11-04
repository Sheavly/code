import type { z } from 'zod';
import type { storedConversationSchema } from './store.validator.js';

/** A stored conversation, as the store lists it. */
export type StoredConversation = z.infer<typeof storedConversationSchema>;
