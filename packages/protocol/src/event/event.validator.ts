import { z } from 'zod';
import { inboxMessageSchema, sessionRefSchema } from '../session/session.validator.js';
import { taskInfoSchema } from '../task/task.validator.js';
import {
  messageSchema,
  reasoningItemSchema,
  toolCallSchema,
  turnStopReasonSchema,
} from '../message/message.validator.js';

/**
 * Data a tool returns for a UI, never for history (so it costs no tokens). `kind` names it
 * (`file_change`, `file_read`, ...); the tool that emits it defines the kind and the rest of its
 * shape, and a UI renders the kinds it knows and skips the others. The harness passes it through
 * hooks and onto the `tool_result` event without looking inside.
 */
export const toolArtifactSchema = z.looseObject({ kind: z.string() });

export const describedCallSchema = z.object({
  call: toolCallSchema,
  /** The model's plain-language note, e.g. "reading index.ts". */
  description: z.string(),
});

export const doneReasonSchema = z.enum(['completed', 'interrupted', 'max_turns']);

/**
 * One step the loop took. Per turn, in causal order:
 *
 *   task_completed × N                            (background tasks that finished since last turn)
 *   → message_received × N                        (messages sent to this session meanwhile)
 *   → context_added × N                           (hooks' `beforeTurn` context, in hook order)
 *   → text_delta / reasoning / tool_call_started  (live, as the model streams)
 *   → turn_end
 *   → tool_batch → tool_result | task_running × N (results in call order)
 *   → next turn ... → done
 */
export const agentEventBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), text: z.string() }),
  /** Opaque reasoning state; kept in history and resent automatically. */
  z.object({ type: z.literal('reasoning'), item: reasoningItemSchema }),
  /** The model asked for a tool and it started running (concurrently with the rest of the turn). */
  describedCallSchema.extend({ type: z.literal('tool_call_started') }),
  z.object({
    type: z.literal('turn_end'),
    turn: z.number().int().nonnegative(),
    stopReason: turnStopReasonSchema,
  }),
  /** The turn ended with these calls; their results follow in this order. */
  z.object({ type: z.literal('tool_batch'), calls: z.array(describedCallSchema) }),
  /**
   * A tool's result, released only after the turn ended and all earlier results were.
   * `artifacts`: what the tool returned for a UI (a file diff, a read range, a parsed table),
   * passed on as the tool (or a hook) left them. A UI renders the kinds it knows.
   */
  describedCallSchema.extend({
    type: z.literal('tool_result'),
    message: messageSchema,
    durationMs: z.number(),
    artifacts: z.array(toolArtifactSchema).readonly().exactOptional(),
  }),
  /** In place of `tool_result` when the call launched a background task: it's still running. */
  describedCallSchema.extend({
    type: z.literal('task_running'),
    task: taskInfoSchema,
    message: messageSchema,
    durationMs: z.number(),
  }),
  /** A background task finished (or failed); the model is told at the start of the next turn. */
  z.object({ type: z.literal('task_completed'), task: taskInfoSchema }),
  /**
   * A message sent to this session while it worked (user steering, or from the session that
   * started it), added to history before this turn's model call.
   */
  z.object({ type: z.literal('message_received'), message: inboxMessageSchema }),
  /** A hook's `beforeTurn` added this context to history; the model sees it from this turn on. */
  z.object({ type: z.literal('context_added'), hook: z.string(), content: z.string() }),
  /**
   * A hook handler failed where it must not stop the run (`onError`). The run's own error is
   * still what ends the stream; this says the hook couldn't do its job.
   */
  z.object({
    type: z.literal('hook_failed'),
    hook: z.string(),
    handler: z.string(),
    error: z.string(),
  }),
  /** Always last. The full conversation (valid to continue from, even after an interrupt). */
  z.object({
    type: z.literal('done'),
    reason: doneReasonSchema,
    messages: z.array(messageSchema),
    session: sessionRefSchema,
  }),
]);

/** Every event carries `seq`: 0, 1, 2, ... with no gaps, in the order consumers receive them. */
export const agentEventSchema = z.intersection(
  z.object({ seq: z.number().int().nonnegative() }),
  agentEventBodySchema,
);
