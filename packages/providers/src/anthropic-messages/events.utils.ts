import type { StopReason, StreamEvent } from '@sheavly/core/message/message.types';
import { ModelApiError } from '../errors/providers.errors.js';
import { parseToolArguments } from '../http/json.utils.js';
import type { MessagesEvent, MessagesStep, StreamingBlock } from './messages.types.js';

/** The API's stop reasons we treat as more than an ended turn; any other ends it normally. */
const STOP_REASONS: Record<string, StopReason> = {
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  model_context_window_exceeded: 'max_tokens',
};

/**
 * Reads one reply's Messages API events, block by block. Text streams as it arrives; a tool call
 * is yielded once its block ends, with its arguments joined and parsed; a thinking block too, as a
 * reasoning item tagged `reasoningSource` (undefined = thinking is off, so none is kept).
 */
export function createMessagesReader(reasoningSource: string | undefined) {
  const blocks = new Map<number, StreamingBlock>();

  const read = (event: MessagesEvent): MessagesStep => {
    switch (event.type) {
      case 'content_block_start':
        blocks.set(event.index, startBlock(event.content_block));

        return { events: [] };
      case 'content_block_delta':
        return { events: applyDelta({ block: blocks.get(event.index), delta: event.delta }) };

      case 'content_block_stop': {
        const block = blocks.get(event.index);

        blocks.delete(event.index);

        return { events: block ? finishBlock({ block, reasoningSource }) : [] };
      }

      case 'message_delta': {
        const stopReason = STOP_REASONS[event.delta.stop_reason ?? ''];

        return stopReason ? { events: [], stopReason } : { events: [] };
      }

      case 'message_stop':
        return { events: [], ended: true };
      case 'error':
        throw new ModelApiError({
          reason: 'stream_error',
          message: `Anthropic Messages API stream error: ${event.error.type}: ${event.error.message}`,
        });
    }
  };

  return { read };
}

type BlockStart = Extract<MessagesEvent, { type: 'content_block_start' }>['content_block'];
type Delta = Extract<MessagesEvent, { type: 'content_block_delta' }>['delta'];

function startBlock(start: BlockStart): StreamingBlock {
  switch (start.type) {
    case 'text':
      return { type: 'text' };
    case 'tool_use':
      return { type: 'tool_use', id: start.id, name: start.name, json: '' };
    case 'thinking':
      return { type: 'thinking', thinking: '', signature: '' };
    case 'redacted_thinking':
      return { type: 'redacted_thinking', data: start.data };
  }
}

/** Adds a delta to its block; only text is yielded at once. A delta for no open block is dropped. */
function applyDelta(params: { block: StreamingBlock | undefined; delta: Delta }): StreamEvent[] {
  const { block, delta } = params;

  if (delta.type === 'text_delta') return [{ type: 'text_delta', text: delta.text }];

  if (block?.type === 'tool_use' && delta.type === 'input_json_delta') {
    block.json += delta.partial_json;
  }

  if (block?.type === 'thinking' && delta.type === 'thinking_delta') {
    block.thinking += delta.thinking;
  }

  if (block?.type === 'thinking' && delta.type === 'signature_delta') {
    block.signature += delta.signature;
  }

  return [];
}

function finishBlock(params: {
  block: StreamingBlock;
  reasoningSource: string | undefined;
}): StreamEvent[] {
  const { block, reasoningSource } = params;

  switch (block.type) {
    case 'text':
      return [];
    case 'tool_use':
      return [
        {
          type: 'tool_call',
          // A call without arguments streams none: that is an empty object, not invalid JSON.
          call: { id: block.id, name: block.name, input: parseToolArguments(block.json || '{}') },
        },
      ];
    case 'thinking':
    case 'redacted_thinking':
      // Resent verbatim on later turns, so it is kept as the API's own block.
      return reasoningSource
        ? [{ type: 'reasoning', item: { source: reasoningSource, data: block } }]
        : [];
  }
}
