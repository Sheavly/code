import type { z } from 'zod';
import type {
  agentEventBodySchema,
  agentEventSchema,
  describedCallSchema,
  doneReasonSchema,
  toolArtifactSchema,
} from './event.validator.js';

export type ToolArtifact = z.infer<typeof toolArtifactSchema>;

export type DescribedCall = z.infer<typeof describedCallSchema>;

export type DoneReason = z.infer<typeof doneReasonSchema>;

export type AgentEventBody = z.infer<typeof agentEventBodySchema>;

export type AgentEvent = z.infer<typeof agentEventSchema>;
