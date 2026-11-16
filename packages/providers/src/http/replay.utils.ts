import { redactDiagnosticText } from '@sheavly/core/text/diagnostic-text.utils';
import type { ReasoningItem } from '@sheavly/protocol/message/message.types';
import { REDACTED_QUERY_VALUE, SECRET_QUERY_NAME } from './http.constants.js';
import type { ReplayDropHandler } from '@sheavly/core/adapter/replay.types';

/**
 * The `source` tag of the reasoning a protocol stores: it names the protocol, the endpoint and
 * the model, so reasoning is replayed only to what produced it. The one place a source is built.
 */
export function replaySource(params: {
  protocol: 'responses' | 'chat' | 'messages';
  endpoint: string;
  model: string;
}): string {
  return `${params.protocol}:${withoutCredentials(params.endpoint)}#${params.model}`;
}

/**
 * The endpoint without anything that authenticates: userinfo and secret-looking query values
 * (`?api-key=`, `?sig=`). The source is stored in history and reported on drops, so a key in the
 * URL must never reach it. Other query values (`api-version`) stay, as they tell endpoints apart.
 */
function withoutCredentials(endpoint: string): string {
  if (!URL.canParse(endpoint)) return redactDiagnosticText(endpoint);

  const url = new URL(endpoint);

  url.username = '';
  url.password = '';

  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_QUERY_NAME.test(name)) url.searchParams.set(name, REDACTED_QUERY_VALUE);
  }

  return url.toString();
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
