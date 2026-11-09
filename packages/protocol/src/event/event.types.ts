import type { z } from 'zod';
import type {
  agentEventBodySchema,
  agentEventSchema,
  describedCallSchema,
  doneReasonSchema,
  entryEventSchema,
  errorDetailsSchema,
  toolArtifactSchema,
} from './event.validator.js';

export type ToolArtifact = z.infer<typeof toolArtifactSchema>;
export type ErrorDetails = z.infer<typeof errorDetailsSchema>;

export type DescribedCall = z.infer<typeof describedCallSchema>;

export type DoneReason = z.infer<typeof doneReasonSchema>;

export type AgentEventBody = z.infer<typeof agentEventBodySchema>;

export type AgentEvent = z.infer<typeof agentEventSchema>;

/** An event as the combined stream carries it: `done` without its `messages`. */
export type EntryEvent = z.infer<typeof entryEventSchema>;
