import type { ReasoningItem } from '@sheavly/protocol/message/message.types';
import type { ReplayDropHandler } from './replay.types.js';

/**
 * The `source` tag of the reasoning a protocol stores: it names the protocol, the endpoint and
 * the model, so reasoning is replayed only to what produced it. The one place a source is built.
 */
export function replaySource(params: {
  protocol: 'responses' | 'chat' | 'messages';
  endpoint: string;
  model: string;
}): string {
  return `${params.protocol}:${params.endpoint}#${params.model}`;
}

/**
 * The items `source` produced: the one compatibility check every protocol uses. An undefined
 * `source` means the provider keeps no reasoning, so every item is left out. Each item left out is
 * reported to `onDropped`; none is dropped silently.
 */
export function ownReplay(params: {
  items: readonly ReasoningItem[] | undefined;
  source: string | undefined;
  onDropped: ReplayDropHandler | undefined;
}): ReasoningItem[] {
  const { items = [], source, onDropped } = params;
  const own: ReasoningItem[] = [];

  for (const item of items) {
    if (source !== undefined && item.source === source) {
      own.push(item);
      continue;
    }

    onDropped?.({
      reason: source === undefined ? 'replay_off' : 'source_mismatch',
      source: item.source,
    });
  }

  return own;
}
