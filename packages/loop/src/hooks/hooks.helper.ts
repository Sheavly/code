import { isDeepStrictEqual } from 'node:util';
import { now } from '@sheavly/core/clock/clock.helper';
import type {
  AfterTurnContext,
  ContextState,
  Hook,
  SummaryReason,
  ToolResult,
} from '@sheavly/core/hook/hook.types';
import type { SummarySection } from '@sheavly/core/summary/summary.types';
import type { Tool, ToolRunResult } from '@sheavly/core/tool/tool.types';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { describeCall } from '@sheavly/core/tool/tool.validator';
import { raceAbort } from '../abort/abort.utils.js';
import { HookError } from '../errors/loop.errors.js';
import { assertValidHistory, countChanges } from '../history/history.utils.js';
import { parseSentMessages } from '../history/history.validator.js';
import { mergeSections, viewOf } from '../summary/summary.utils.js';
import { parseSummaryChange } from './summary-change.validator.js';
import type { ToolArtifact } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type {
  Message,
  SummaryMessage,
  ToolCall,
  ToolMessage,
} from '@sheavly/protocol/message/message.types';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/** Someone to tell about every context addition (the loop emits `context_added`). */
type OnContext = (added: { hook: string; content: string }) => void;

/**
 * `addContext` for one hook: appends a user message to the run's history and reports it. Every
 * handler is handed the model's view of that history (`viewOf`), never the stored entries: a
 * hook sees the shortened state after a summary and never the `summary` role.
 */
function contextAdder(params: { hook: Hook; messages: HistoryMessage[]; onContext: OnContext }) {
  const { hook, messages, onContext } = params;

  return (content: string) => {
    messages.push({ role: 'user', content, at: now() });
    onContext({ hook: hook.name, content });
  };
}

/** Runs every `sessionStart` handler in order, once per run, before the first turn. */
export async function runSessionStart(params: {
  hooks: Hook[];
  messages: HistoryMessage[];
  signal: AbortSignal;
  onContext: OnContext;
}): Promise<void> {
  const { hooks, messages, signal, onContext } = params;

  for (const hook of hooks) {
    if (!hook.sessionStart) continue;
    await hook.sessionStart({
      messages: viewOf(messages),
      signal,
      addContext: contextAdder({ hook, messages, onContext }),
    });
  }
}

/**
 * Runs every `beforeTurn` handler in order. Each sees the history including context added by
 * the hooks before it; `onContext` hears about every addition (for the event stream). Returns
 * the system instructions the hooks added for this turn, in hook order.
 */
export async function runBeforeTurn(params: {
  hooks: Hook[];
  turn: number;
  messages: HistoryMessage[];
  context: ContextState;
  signal: AbortSignal;
  onContext: OnContext;
}): Promise<string[]> {
  const { hooks, turn, messages, context, signal, onContext } = params;
  const instructions: string[] = [];

  for (const hook of hooks) {
    if (!hook.beforeTurn) continue;
    await hook.beforeTurn({
      turn,
      context: { ...context },
      messages: viewOf(messages),
      signal,
      addContext: contextAdder({ hook, messages, onContext }),
      addInstructions: (content) => {
        if (content.trim()) instructions.push(content);
      },
    });
  }

  return instructions;
}

/**
 * Runs every `beforeModelCall` handler in order for one model call; each gets a deep copy of the
 * previous result and may return other messages. Returns the messages to send. The copies mean
 * a hook that edits what it was given (it may be plain JavaScript) changes nothing stored, and
 * the result is parsed into new objects, so it can't be changed after it was checked either.
 * A result that is not a list of messages, or that breaks the history rules, throws an
 * `InvalidHistoryError` naming the hook. A hook that returns its input unchanged is never
 * blamed: history that was already broken is the caller's to deal with. `onChanged` hears about
 * every hook whose result added, dropped or edited messages (`countChanges`), for the event
 * stream.
 */
export async function runBeforeModelCall(params: {
  hooks: Hook[];
  turn: number;
  messages: readonly Message[];
  context: ContextState;
  signal: AbortSignal;
  onChanged: (change: { hook: string; added: number; removed: number; edited: number }) => void;
}): Promise<readonly Message[]> {
  const { hooks, turn, messages, context, signal, onChanged } = params;
  const latestUser = messages.findLast((message) => message.role === 'user');
  let current = messages;

  for (const hook of hooks) {
    if (!hook.beforeModelCall) continue;

    const source = `Hook ${hook.name}`;
    // Typed `unknown`: a project hook is plain JavaScript, so its return value is unchecked.
    const result: unknown = await hook.beforeModelCall({
      turn,
      messages: structuredClone(current),
      context: { ...context },
      signal,
    });
    const sent = parseSentMessages({ input: result, source });

    if (isDeepStrictEqual(sent, current)) continue;

    assertValidHistory({ messages: sent, latestUser, source });

    const { added, removed, edited } = countChanges({ before: current, after: sent });

    if (added > 0 || removed > 0 || edited > 0) {
      onChanged({ hook: hook.name, added, removed, edited });
    }

    current = sent;
  }

  return current;
}

/**
 * Runs every `beforeSummary` handler in order and combines what they asked for: the last
 * `keepTokens` wins, and the sections add up (a later hook's replaces an earlier one's with the
 * same id). Each handler gets a deep copy of the view, so editing it changes nothing stored. A
 * handler that throws is a `HookError`, and a result that is not a valid change a
 * `SummaryHookError`, both naming the hook; the caller reports either as a failed summary. Stops
 * asking hooks once the run aborts.
 */
export async function runBeforeSummary(params: {
  hooks: Hook[];
  reason: SummaryReason;
  messages: readonly Message[];
  context: ContextState;
  signal: AbortSignal;
}): Promise<{ keepTokens: number | undefined; sections: SummarySection[] }> {
  const { hooks, reason, messages, context, signal } = params;
  let keepTokens: number | undefined;
  let sections: SummarySection[] = [];

  for (const hook of hooks) {
    // Stop asking once aborted; the caller sees the abort and fails the summary.
    if (signal.aborted) break;

    if (!hook.beforeSummary) continue;

    // Typed `unknown`: a project hook is plain JavaScript, so its return value is unchecked.
    // Raced against the abort, like the summarizer: a hook that ignores its signal must not hold
    // the run.
    const result: unknown = await raceAbort({
      work: hook.beforeSummary({
        reason,
        messages: structuredClone(messages),
        context: { ...context },
        signal,
      }),
      signal,
    }).catch((caughtError: unknown) => {
      throw new HookError({ hook: hook.name, handler: 'beforeSummary', cause: caughtError });
    });

    if (signal.aborted) break;

    const change = parseSummaryChange({ input: result, hook: hook.name });

    keepTokens = change?.keepTokens ?? keepTokens;
    sections = mergeSections({ written: sections, added: change?.sections ?? [] });
  }

  return { keepTokens, sections };
}

/**
 * Runs every `afterSummary` handler in order, once the checkpoint is in history. Each gets copies
 * of the checkpoint and of the model's view of history (`viewOf`), and what it adds with
 * `addContext` lands after the checkpoint, reported through `onContext` like any other context.
 * Stops waiting for a hook, and asking the next, once the run aborts.
 */
export async function runAfterSummary(params: {
  hooks: Hook[];
  reason: SummaryReason;
  checkpoint: SummaryMessage;
  messages: HistoryMessage[];
  signal: AbortSignal;
  onContext: OnContext;
}): Promise<void> {
  const { hooks, reason, checkpoint, messages, signal, onContext } = params;

  for (const hook of hooks) {
    if (signal.aborted) return;

    if (!hook.afterSummary) continue;

    const addContext = contextAdder({ hook, messages, onContext });

    // Copies, so a plain-JavaScript hook that edits what it was given can't change the stored
    // checkpoint after `buildCheckpoint` checked it; each hook gets its own. Raced against the
    // abort like `beforeSummary`, and a hook still running after it adds nothing: the run was
    // told to stop, and history is not for a late `addContext` to grow.
    await raceAbort({
      work: hook.afterSummary({
        reason,
        checkpoint: structuredClone(checkpoint),
        messages: structuredClone(viewOf(messages)),
        signal,
        addContext: (content) => {
          if (!signal.aborted) addContext(content);
        },
      }),
      signal,
    });
  }
}

/** Runs every `afterTurn` handler in order, once the turn's reply and results are in history. */
export async function runAfterTurn(
  params: { hooks: Hook[] } & Omit<AfterTurnContext, 'messages'> & { messages: HistoryMessage[] },
): Promise<void> {
  const { hooks, messages, ...turn } = params;

  for (const hook of hooks) {
    if (!hook.afterTurn) continue;
    await hook.afterTurn({ ...turn, messages: viewOf(messages) });
  }
}

/**
 * Tells every `onError` handler, in order, that the run failed. A handler that throws doesn't
 * stop the others, and the original error is still the one the caller sees; its failure is
 * reported through `onHookError` as a `HookError` (the loop emits `hook_failed`).
 */
export async function runOnError(params: {
  hooks: Hook[];
  error: unknown;
  messages: HistoryMessage[];
  onHookError: (failure: HookError) => void;
}): Promise<void> {
  const { hooks, error, messages, onHookError } = params;

  for (const hook of hooks) {
    await hook.onError?.({ error, messages: viewOf(messages) }).catch((caughtError: unknown) => {
      onHookError(new HookError({ hook: hook.name, handler: 'onError', cause: caughtError }));
    });
  }
}

/**
 * Runs a tool call through every `aroundToolCall` handler (the first is outermost), then the
 * tool. Never throws: a failing hook becomes an error result, like a failing tool. Returns the
 * history message and, apart from it, the tool's artifacts (which the model never sees).
 */
export async function runToolCall(params: {
  hooks: Hook[];
  tools: Tool[];
  call: ToolCall;
  signal: AbortSignal;
  /** The calling session, handed to the tool (`context.session`). */
  session?: SessionRef | undefined;
}): Promise<{ message: ToolMessage; artifacts?: readonly ToolArtifact[] | undefined }> {
  const { hooks, tools, call, signal, session } = params;
  const handlers = hooks.filter((hook) => hook.aroundToolCall);
  const description = describeCall(call);

  const runFrom = async (index: number, current: ToolCall): Promise<ToolResult> => {
    const hook = handlers[index];

    if (!hook?.aroundToolCall) {
      return toResult(await runTool({ tools, call: current, signal, session }));
    }

    try {
      return await hook.aroundToolCall({
        call: current,
        description,
        signal,
        next: (input) => runFrom(index + 1, input === undefined ? current : { ...current, input }),
      });
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : String(caughtError);

      return { content: `Hook ${hook.name} failed: ${reason}`, isError: true };
    }
  };

  const { content, isError, artifacts } = await runFrom(0, call);

  return {
    message: { role: 'tool', toolCallId: call.id, content, isError, at: now() },
    artifacts,
  };
}

function toResult(run: ToolRunResult): ToolResult {
  return { content: run.content, isError: run.isError, artifacts: run.artifacts };
}
