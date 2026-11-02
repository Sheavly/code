import type { Message, ToolCall, ToolMessage } from '@sheavly/core/message/message.types';
import type { AfterTurnContext, Hook, ToolResult } from '@sheavly/core/hook/hook.types';
import type { Tool, ToolArtifact, ToolRunResult } from '@sheavly/core/tool/tool.types';
import type { SessionRef } from '@sheavly/core/session/session.types';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { describeCall } from '@sheavly/core/tool/tool.validator';
import { HookError } from '../../runtime/errors/hooks.errors.js';

/** Someone to tell about every context addition (the loop emits `context_added`). */
type OnContext = (added: { hook: string; content: string }) => void;

/** `addContext` for one hook: appends a user message to the run's history and reports it. */
function contextAdder(params: { hook: Hook; messages: Message[]; onContext: OnContext }) {
  const { hook, messages, onContext } = params;

  return (content: string) => {
    messages.push({ role: 'user', content });
    onContext({ hook: hook.name, content });
  };
}

/** Runs every `sessionStart` handler in order, once per run, before the first turn. */
export async function runSessionStart(params: {
  hooks: Hook[];
  messages: Message[];
  signal: AbortSignal;
  onContext: OnContext;
}): Promise<void> {
  const { hooks, messages, signal, onContext } = params;

  for (const hook of hooks) {
    if (!hook.sessionStart) continue;
    await hook.sessionStart({
      messages: [...messages],
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
  messages: Message[];
  signal: AbortSignal;
  onContext: OnContext;
}): Promise<string[]> {
  const { hooks, turn, messages, signal, onContext } = params;
  const instructions: string[] = [];

  for (const hook of hooks) {
    if (!hook.beforeTurn) continue;
    await hook.beforeTurn({
      turn,
      messages: [...messages],
      signal,
      addContext: contextAdder({ hook, messages, onContext }),
      addInstructions: (content) => {
        if (content.trim()) instructions.push(content);
      },
    });
  }

  return instructions;
}

/** Runs every `afterTurn` handler in order, once the turn's reply and results are in history. */
export async function runAfterTurn(
  params: { hooks: Hook[] } & Omit<AfterTurnContext, 'messages'> & { messages: Message[] },
): Promise<void> {
  const { hooks, messages, ...turn } = params;

  for (const hook of hooks) {
    if (!hook.afterTurn) continue;
    await hook.afterTurn({ ...turn, messages: [...messages] });
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
  messages: Message[];
  onHookError: (failure: HookError) => void;
}): Promise<void> {
  const { hooks, error, messages, onHookError } = params;

  for (const hook of hooks) {
    await hook.onError?.({ error, messages: [...messages] }).catch((caughtError: unknown) => {
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

  return { message: { role: 'tool', toolCallId: call.id, content, isError }, artifacts };
}

function toResult(run: ToolRunResult): ToolResult {
  return { content: run.content, isError: run.isError, artifacts: run.artifacts };
}
