import type { StreamEvent, ToolCall } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';

/** Test-only provider: each call to `stream` plays back the next scripted response. */
export function scriptedProvider(responses: StreamEvent[][]): Provider {
  let call = 0;

  return {
    async *stream() {
      const events = responses[call++];

      if (!events) throw new Error('scriptedProvider ran out of responses');
      yield* events;
    },
  };
}

/** The most common script: the model makes one tool call, then ends its turn. */
export function callOnceProvider(call: ToolCall): Provider {
  return scriptedProvider([
    [
      { type: 'tool_call', call },
      { type: 'done', stopReason: 'tool_use' },
    ],
    [{ type: 'done', stopReason: 'end_turn' }],
  ]);
}
