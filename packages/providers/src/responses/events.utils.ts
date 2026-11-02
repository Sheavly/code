import type { ToolCall } from '@sheavly/core/message/message.types';
import { ResponsesApiError } from '../errors/providers.errors.js';
import type { EventStep, FunctionCallItem, ResponsesEvent } from './responses.types.js';

/**
 * What one Responses API event means for us.
 * `reasoningSource` undefined = reasoning is off, so reasoning items are dropped.
 */
export function handleEvent(params: {
  event: ResponsesEvent;
  reasoningSource: string | undefined;
}): EventStep {
  const { event, reasoningSource } = params;

  switch (event.type) {
    case 'response.output_text.delta':
      return { event: { type: 'text_delta', text: event.delta } };
    case 'response.output_item.done':
      if (event.item.type !== 'reasoning') {
        return {
          event: { type: 'tool_call', call: toToolCall(event.item) },
          stopReason: 'tool_use',
        };
      }

      return reasoningSource
        ? { event: { type: 'reasoning', item: { source: reasoningSource, data: event.item } } }
        : {};
    case 'response.completed':
      return { ended: true };
    case 'response.incomplete':
      return event.response.incomplete_details?.reason === 'max_output_tokens'
        ? { stopReason: 'max_tokens', ended: true }
        : { ended: true };
    case 'response.failed':
      throw new ResponsesApiError({
        reason: 'failed',
        message: `Responses API failed: ${event.response.error?.message ?? 'unknown error'}`,
      });
    case 'error':
      throw new ResponsesApiError({
        reason: 'stream_error',
        message: `Responses API stream error: ${event.error?.message ?? event.message ?? 'unknown error'}`,
      });
  }
}

function toToolCall(item: FunctionCallItem): ToolCall {
  let input: unknown;

  try {
    input = JSON.parse(item.arguments);
  } catch (caughtError) {
    if (!(caughtError instanceof SyntaxError)) throw caughtError;
    input = item.arguments; // invalid JSON: the tool's zod schema will reject it and tell the model
  }

  return { id: item.call_id, name: item.name, input };
}
