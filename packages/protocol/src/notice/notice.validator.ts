import { z } from 'zod';
import { callIdSchema } from '../message/message.validator.js';
import { contextWindowSchema } from '../model/model.validator.js';
import { timestampSchema } from '../time/time.validator.js';
import { agentInfoSchema, runOutcomeSchema } from '../session/session.validator.js';
import { taskIdSchema, taskInfoSchema } from '../task/task.validator.js';
import { tokenUsageSchema } from '../usage/usage.validator.js';

const contextStateSchema = z.union([
  z.object({
    window: contextWindowSchema,
    used: tokenUsageSchema.shape.inputTokens.optional(),
  }),
  z.object({
    window: z.never().optional(),
    used: tokenUsageSchema.shape.inputTokens,
  }),
]);

/**
 * Notices that belong to one model call: sent beside the history, never stored in it. Stale on the
 * next call (a context count) or already carried by history (a continuation's partial reply).
 */
const transientNoticeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('context-usage'), context: contextStateSchema }),
  z.object({
    kind: z.literal('output-continuation'),
    attempt: z.number().int().positive(),
    maxAttempts: z.number().int().positive().optional(),
  }),
]);

/** Completion-time facts; the reason is agent-authored data, not model instructions. */
export const taskCompletionContextSchema = z.object({
  reason: z.string(),
  startedAt: timestampSchema,
  durationMs: z.number().nonnegative(),
  userMessagesSinceStart: z.number().int().nonnegative(),
  callId: callIdSchema.exactOptional(),
});

/**
 * Notices the model must remember, so they are stored in history as typed data and shown to the
 * model through the core formatter. A UI reads the same data from history and the event stream and
 * decides whether and how to render it. Each is a snapshot at the moment it was written: live
 * state still comes from the session stream, and a UI joins the two by id.
 */
const individualPersistentNoticeSchema = z.discriminatedUnion('kind', [
  /** A sub-agent finished: who it is and how it ended, and the complete report it wrote. */
  z.object({
    kind: z.literal('agent-report'),
    agent: agentInfoSchema,
    /** The background task the parent started it as. */
    taskId: taskIdSchema,
    outcome: runOutcomeSchema,
    /** What the sub-agent reported, whole: its final answer and nothing else. */
    report: z.string(),
    /** Optional only so stored histories written without completion context remain readable. */
    context: taskCompletionContextSchema.exactOptional(),
  }),
  /** A background task finished: its snapshot, whose `output` stays the bounded preview. */
  z.object({
    kind: z.literal('task-finished'),
    task: taskInfoSchema,
    context: taskCompletionContextSchema.exactOptional(),
  }),
]);

/** A completion delivery retains the agent-authored wait reason as data, not instructions. */
export const persistentNoticeSchema = z.union([
  individualPersistentNoticeSchema,
  z.object({
    kind: z.literal('tasks-finished'),
    reason: z.string(),
    notices: z.array(individualPersistentNoticeSchema).min(1),
    context: taskCompletionContextSchema.exactOptional(),
  }),
]);

/** Harness-originated data shared by the model and UI, without model instructions or UI styling. */
export const harnessNoticeSchema = z.union([transientNoticeSchema, persistentNoticeSchema]);
