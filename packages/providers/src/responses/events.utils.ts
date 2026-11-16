import { providerErrorText } from '@sheavly/core/text/diagnostic-text.utils';
import { ModelApiError } from '../errors/providers.errors.js';
import { parseToolArguments } from '../http/json.utils.js';
import type { EventStep, FunctionCallItem, ResponsesEvent } from './responses.types.js';
import type { ToolCall } from '@sheavly/protocol/message/message.types';

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
      return { events: [{ type: 'text_delta', text: event.delta }] };
    case 'response.output_item.added':
      return event.item.type === 'reasoning'
        ? { events: [{ type: 'reasoning_activity', active: true }] }
        : {};
    case 'response.output_item.done':
      if (event.item.type !== 'reasoning') {
        return {
          events: [{ type: 'tool_call', call: toToolCall(event.item) }],
          stopReason: 'tool_use',
        };
      }

      // Activity ends with the item whatever its payload; only replay needs encrypted content.
      return {
        events: [
          { type: 'reasoning_activity', active: false },
          ...(reasoningSource && event.item.encrypted_content
            ? [{ type: 'reasoning' as const, item: { source: reasoningSource, data: event.item } }]
            : []),
        ],
      };
    case 'response.completed':
      return { ended: true, ...usageOf(event.response?.usage) };
    case 'response.incomplete':
      return event.response.incomplete_details?.reason === 'max_output_tokens'
        ? { stopReason: 'max_tokens', ended: true, ...usageOf(event.response.usage) }
        : { ended: true, ...usageOf(event.response.usage) };
    case 'response.failed':
      throw new ModelApiError({
        reason: 'failed',
        message: `Responses API failed: ${providerErrorText(event.response.error?.message ?? 'unknown error')}`,
      });
    case 'error':
      throw new ModelApiError({
        reason: 'stream_error',
        message: `Responses API stream error: ${providerErrorText(event.error?.message ?? event.message ?? 'unknown error')}`,
      });
  }
}

function usageOf(
  usage: NonNullable<Extract<ResponsesEvent, { type: 'response.completed' }>['response']>['usage'],
) {
  if (!usage) return {};

  return {
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.input_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
    },
  };
}

function toToolCall(item: FunctionCallItem): ToolCall {
  return { id: item.call_id, name: item.name, input: parseToolArguments(item.arguments) };
}
