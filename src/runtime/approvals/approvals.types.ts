import type { z } from 'zod';
import type { approvalResponseSchema } from './approvals.validator.js';

/** One argument that makes a command need approval, and why. */
export type ApprovalConcern = { argument: string; reason: string };

/** What the user can answer. */
export type ApprovalOption = ApprovalResponse['decision'];

/**
 * A tool is waiting for the user: "the agent wants to run this; approve it?". A UI renders it its
 * own way and answers with `ApprovalRegistry.respond`.
 */
export type ApprovalRequest = {
  /** Answer with this id. */
  id: string;
  /** The tool call that is waiting (matches `tool_call_started`). */
  callId: string;
  /** The session making the call, when a loop runs it. */
  sessionId?: string;
  tool: string;
  command: string;
  concerns: ApprovalConcern[];
  options: readonly ApprovalOption[];
};

/**
 * The user's answer: run it as asked, skip it, or skip it and steer the agent with a message
 * (passed to the model in the tool result).
 */
export type ApprovalResponse = z.infer<typeof approvalResponseSchema>;

/** Everything a subscriber (a UI) hears from an `ApprovalRegistry`. */
export type ApprovalUpdate =
  | { type: 'approval_requested'; request: ApprovalRequest }
  | { type: 'approval_resolved'; id: string; response: ApprovalResponse }
  /** The waiting call was interrupted before anyone answered. */
  | { type: 'approval_cancelled'; id: string };
