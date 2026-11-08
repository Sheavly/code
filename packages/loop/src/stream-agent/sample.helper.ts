import { now } from '@sheavly/core/clock/clock.helper';
import { toDefinition } from '@sheavly/core/tool/tool.utils';
import { describeCall } from '@sheavly/core/tool/tool.validator';
import { untilAborted, whenAborted } from '../abort/abort.utils.js';
import { contextNotice } from '../context/context.utils.js';
import type { ToolOutcome } from '../events/events.types.js';
import { runToolCall } from '../hooks/hooks.helper.js';
import { INTERRUPTED_BY_USER, STOPPED_BY_FAILURE } from './stream-agent.constants.js';
import type { RunningCall, SampleContext, SampleFailure, ToolStart } from './stream-agent.types.js';
import type { DescribedCall } from '@sheavly/protocol/event/event.types';
import type { ModelUsage } from '@sheavly/protocol/usage/usage.types';
import type {
  Message,
  ReasoningItem,
  ToolCall,
  ToolMessage,
  TurnStopReason,
} from '@sheavly/protocol/message/message.types';

/**
 * One model call: stream the response into an assistant message.
 * Tool calls start running the moment they arrive, while the model keeps streaming.
 * On abort, keeps whatever the model produced so far. If the model call fails, the tools it
 * started are stopped and `failure` holds the error, so the turn can record them before failing.
 */
export async function sample(context: SampleContext) {
  const { provider, instructions, tools, messages, signal, aborted, events } = context;
  const { state } = context;
  const { window } = state;
  let content = '';
  const toolCalls: ToolCall[] = [];
  const reasoning: ReasoningItem[] = [];
  const running: RunningCall[] = [];
  let stopReason: TurnStopReason = 'end_turn';
  let failure: SampleFailure | undefined;
  let usage: ModelUsage = { tokens: null };
  // The tools' own signal: aborted with the run, or when this model call fails.
  const stopTools = new AbortController();
  const toolSignal = AbortSignal.any([signal, stopTools.signal]);
  const stopped = Promise.race([
    aborted.then(() => INTERRUPTED_BY_USER),
    whenAborted(stopTools.signal).then(() => STOPPED_BY_FAILURE),
  ]);
  const start = { ...context, signal: toolSignal };

  try {
    // A snapshot: providers must never see later pushes to the loop's own history. The context
    // line goes beside it, not in it: it changes every turn, so a provider sends it after the
    // history, and it is not in `messages`, in `done`'s messages or in the next request.
    const source = provider.stream({
      instructions,
      messages: [...messages],
      notice: contextNotice(state),
      tools: tools.map(toDefinition),
      signal,
    });

    for await (const event of untilAborted({ source, aborted })) {
      switch (event.type) {
        case 'text_delta':
          content += event.text;
          events.enqueue(event);
          break;
        case 'reasoning':
          reasoning.push(event.item);
          events.enqueue(event);
          break;

        case 'tool_call': {
          const described = { call: event.call, description: describeCall(event.call) };

          toolCalls.push(event.call);
          events.enqueue({ type: 'tool_call_started', ...described });
          running.push({ described, outcome: startTool({ start, described, stopped }) });
          break;
        }

        case 'done':
          stopReason = event.stopReason;
          usage = event.usage ?? { tokens: null };
          break;
      }
    }
  } catch (caughtError) {
    // A real provider failure, not our interrupt: stop the tools it started, then report it.
    if (!signal.aborted) {
      failure = { error: caughtError };
      stopTools.abort(caughtError);
    }
  }

  // The window the call ran against: the reading taken before the call, the same the agent was
  // told. It replaces a window the provider may have put on its own usage.
  events.enqueue({
    type: 'usage',
    usage: window === undefined ? usage : { ...usage, contextWindow: window },
  });
  if (signal.aborted || failure) stopReason = 'interrupted';

  const message: Message = {
    role: 'assistant',
    content,
    toolCalls,
    ...(reasoning.length > 0 ? { reasoning } : {}),
    at: now(),
  };

  return { message, stopReason, running, failure };
}

/**
 * Starts a tool now, through the run's hooks. `runToolCall` never throws, so one failure can't
 * sink the others.
 * When `stopped` resolves (the run aborted, or the model call failed) the tool is told to stop
 * (via `signal`) and its result becomes that placeholder right away, even if it ignores the signal.
 * If the call launched a background task, the outcome is `task_running` instead of a result.
 */
async function startTool(params: {
  start: ToolStart;
  described: DescribedCall;
  stopped: Promise<string>;
}): Promise<ToolOutcome> {
  const { start, described, stopped } = params;
  const { tools, hooks = [], tasks, session, signal } = start;
  const { call, description } = described;
  const started = performance.now();
  const { message, artifacts } = await Promise.race([
    runToolCall({ hooks, tools, call, signal, session }),
    stopped.then((content) => {
      const placeholder: ToolMessage = {
        role: 'tool',
        toolCallId: call.id,
        content,
        isError: true,
        at: now(),
      };

      return { message: placeholder, artifacts: undefined };
    }),
  ]);
  const durationMs = performance.now() - started;

  const task = tasks?.byCallId(call.id);

  if (task && !message.isError) {
    return { type: 'task_running', task, call, description, message, durationMs };
  }

  return {
    type: 'tool_result',
    call,
    description,
    message,
    durationMs,
    ...(artifacts?.length ? { artifacts } : {}),
  };
}
