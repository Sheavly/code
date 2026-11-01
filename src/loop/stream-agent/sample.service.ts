import type {
  Message,
  ReasoningItem,
  ToolCall,
  ToolMessage,
  TurnStopReason,
} from '@sheavly/core/message/message.types';
import { describeCall, toDefinition } from '@sheavly/core/tool/tool.service';
import { untilAborted } from '../abort/abort.utils.js';
import type { DescribedCall, ToolOutcome } from '../events/events.types.js';
import { runToolCall } from '../hooks/hooks.service.js';
import type { RunningCall, SampleContext, ToolStart } from './stream-agent.types.js';

/**
 * One model call: stream the response into an assistant message.
 * Tool calls start running the moment they arrive, while the model keeps streaming.
 * On abort, keeps whatever the model produced so far.
 */
export async function sample(context: SampleContext) {
  const { provider, instructions, tools, messages, signal, aborted, events } = context;
  let content = '';
  const toolCalls: ToolCall[] = [];
  const reasoning: ReasoningItem[] = [];
  const running: RunningCall[] = [];
  let stopReason: TurnStopReason = 'end_turn';

  try {
    // A snapshot: providers must never see later pushes to the loop's own history.
    const source = provider.stream({
      instructions,
      messages: [...messages],
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
          running.push({ described, outcome: startTool({ start: context, described }) });
          break;
        }

        case 'done':
          stopReason = event.stopReason;
          break;
      }
    }
  } catch (caughtError) {
    if (!signal.aborted) throw caughtError; // a real provider failure, not our interrupt
  }

  if (signal.aborted) stopReason = 'interrupted';

  const message: Message = {
    role: 'assistant',
    content,
    toolCalls,
    ...(reasoning.length > 0 ? { reasoning } : {}),
  };

  return { message, stopReason, running };
}

/**
 * Starts a tool now, through the run's hooks. `runToolCall` never throws, so one failure can't
 * sink the others.
 * On abort the tool is told to stop (via `signal`) and its result becomes "interrupted"
 * right away, even if the tool ignores the signal.
 * If the call launched a background task, the outcome is `task_running` instead of a result.
 */
async function startTool(params: {
  start: ToolStart;
  described: DescribedCall;
}): Promise<ToolOutcome> {
  const { tools, hooks = [], tasks, session, signal, aborted } = params.start;
  const { call, description } = params.described;
  const started = performance.now();
  const interrupted: ToolMessage = {
    role: 'tool',
    toolCallId: call.id,
    content: 'Interrupted by the user before this tool finished.',
    isError: true,
  };
  const { message, change } = await Promise.race([
    runToolCall({ hooks, tools, call, signal, session }),
    aborted.then(() => ({ message: interrupted, change: undefined })),
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
    ...(change && { change }),
  };
}
