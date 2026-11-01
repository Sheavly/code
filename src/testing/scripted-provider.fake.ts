import type { StreamEvent } from '@sheavly/core/message/message.types';
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
