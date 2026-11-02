import type { z } from 'zod';
import type {
  inboxMessageSchema,
  sessionInfoSchema,
  sessionRefSchema,
  sessionStateSchema,
  sessionUpdateSchema,
} from './session.validator.js';

export type SessionRef = z.infer<typeof sessionRefSchema>;

export type SessionState = z.infer<typeof sessionStateSchema>;

export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export type InboxMessage = z.infer<typeof inboxMessageSchema>;

export type SessionUpdate = z.infer<typeof sessionUpdateSchema>;
