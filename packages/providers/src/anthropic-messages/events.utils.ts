import type { StreamEvent } from '@sheavly/core/message/message.types';
import { providerErrorText } from '@sheavly/core/text/diagnostic-text.utils';
import { ModelApiError } from '../errors/providers.errors.js';
import { parseToolArguments } from '../http/json.utils.js';
import { STOP_REASONS } from './messages.constants.js';
import type {
  MessagesEvent,
  MessagesReplay,
  MessagesStep,
  StreamingBlock,
} from './messages.types.js';

/**
 * Reads one reply's Messages API events, block by block. Text streams as it arrives; a tool call
 * is yielded once its block ends. A completed reply keeps the original block order and request
 * prefix as opaque replay state (undefined source = thinking is off, so none is kept).
 */
export function createMessagesReader(params: {
  reasoningSource: string | undefined;
  prefix: string;
}) {
  const { reasoningSource, prefix } = params;
  const blocks = new Map<number, StreamingBlock>();
  const content: MessagesReplay['content'] = [];
  let reportedStop: string | undefined;

  const read = (event: MessagesEvent): MessagesStep => {
    switch (event.type) {
      case 'message_start':
        return { events: [] };
      case 'content_block_start':
        blocks.set(event.index, startBlock(event.content_block));

        return { events: startEvents(event.content_block) };
      case 'content_block_delta':
        return { events: applyDelta({ block: blocks.get(event.index), delta: event.delta }) };

      case 'content_block_stop': {
        const block = blocks.get(event.index);

        blocks.delete(event.index);

        if (!block) return { events: [] };

        const finished = finishBlock(block);

        content.push(finished);

        return { events: stopEvents(finished) };
      }

      case 'message_delta': {
        reportedStop = event.delta.stop_reason ?? reportedStop;
        const stopReason = STOP_REASONS[event.delta.stop_reason ?? ''];

        return stopReason ? { events: [], stopReason } : { events: [] };
      }

      case 'message_stop':
        return finishReply({ blocks, content, reasoningSource, prefix, reportedStop });
      case 'error':
        throw new ModelApiError({
          reason: 'stream_error',
          message: `Anthropic Messages API stream error: ${providerErrorText(`${event.error.type}: ${event.error.message}`)}`,
        });
    }
  };

  return { read };
}

/** An explicit output cap can leave a block open; never execute or replay that unfinished block. */
function finishReply(params: {
  blocks: ReadonlyMap<number, StreamingBlock>;
  content: MessagesReplay['content'];
  reasoningSource: string | undefined;
  prefix: string;
  reportedStop: string | undefined;
}): MessagesStep {
  const { blocks, content, reasoningSource, prefix, reportedStop } = params;

  if (blocks.size > 0 && reportedStop !== 'max_tokens') {
    const unfinished = [...blocks]
      .map(([index, block]) => `${String(index)}:${block.type}`)
      .join(', ');

    throw new ModelApiError({
      reason: 'cut_off',
      message: `Messages reply ended with unfinished content blocks (stop reason: ${reportedStop ?? 'unknown'}; blocks: ${unfinished})`,
    });
  }

  // Text has already streamed and completed calls already started. Partial replay would omit the
  // unfinished text or unsigned thinking, so let the next request rebuild from the visible history.
  if (blocks.size > 0 || !reasoningSource) {
    // A capped reply can leave a thinking block open; its activity must still end.
    const open = [...blocks.values()].some(isThinking);

    return { events: open ? [{ type: 'reasoning_activity', active: false }] : [], ended: true };
  }

  return {
    events: [
      {
        type: 'reasoning',
        item: { source: reasoningSource, data: { type: 'messages-replay', prefix, content } },
      },
    ],
    ended: true,
  };
}

type BlockStart = Extract<MessagesEvent, { type: 'content_block_start' }>['content_block'];
type Delta = Extract<MessagesEvent, { type: 'content_block_delta' }>['delta'];

function startEvents(start: BlockStart): StreamEvent[] {
  if (start.type === 'text' && start.text) return [{ type: 'text_delta', text: start.text }];

  if (isThinking(start)) return [{ type: 'reasoning_activity', active: true }];

  return [];
}

/** The block kinds that mean the model is reasoning, visible or redacted. */
function isThinking(block: { type: string }): boolean {
  return block.type === 'thinking' || block.type === 'redacted_thinking';
}

function stopEvents(finished: MessagesReplay['content'][number]): StreamEvent[] {
  if (finished.type === 'tool_use') {
    return [
      { type: 'tool_call', call: { id: finished.id, name: finished.name, input: finished.input } },
    ];
  }

  if (isThinking(finished)) return [{ type: 'reasoning_activity', active: false }];

  return [];
}

function startBlock(start: BlockStart): StreamingBlock {
  switch (start.type) {
    case 'text':
      return { type: 'text', text: start.text };
    case 'tool_use':
      return { type: 'tool_use', id: start.id, name: start.name, json: '' };
    case 'thinking':
      return { type: 'thinking', thinking: start.thinking, signature: start.signature };
    case 'redacted_thinking':
      return { type: 'redacted_thinking', data: start.data };
  }
}

/** Adds a delta to its block; only text is yielded at once. A delta for no open block is dropped. */
function applyDelta(params: { block: StreamingBlock | undefined; delta: Delta }): StreamEvent[] {
  const { block, delta } = params;

  if (block?.type === 'text' && delta.type === 'text_delta') {
    block.text += delta.text;

    return [{ type: 'text_delta', text: delta.text }];
  }

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

function finishBlock(block: StreamingBlock): MessagesReplay['content'][number] {
  if (block.type === 'thinking' && !block.signature) {
    throw new ModelApiError({
      reason: 'bad_payload',
      message: 'Messages thinking block ended without its signature',
    });
  }

  if (block.type !== 'tool_use') return block;

  // A call without arguments streams none: that is an empty object, not invalid JSON.
  return {
    type: 'tool_use',
    id: block.id,
    name: block.name,
    input: parseToolArguments(block.json || '{}'),
  };
}
