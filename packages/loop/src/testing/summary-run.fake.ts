import { z } from 'zod';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { WINDOW } from './summary-run.constants.js';

/** A tool that finds something, for runs that need a tool call. */
export const probe = defineTool({
  name: 'probe',
  description: 'Looks something up',
  inputSchema: z.object({}),
  execute: async () => 'found it',
});

/** The call to `probe` that `toolTurn` makes. */
export const probeCall = {
  id: callIdSchema.parse('c1'),
  name: 'probe',
  input: { description: 'probing' },
};

/** A model turn that calls the probe and reports `inputTokens` of context. */
export function toolTurn(inputTokens: number): StreamEvent[] {
  const tokens = { inputTokens, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };

  return [
    { type: 'tool_call', call: probeCall },
    { type: 'done', stopReason: 'tool_use', usage: { tokens } },
  ];
}

/** 400 characters: about 100 tokens by the estimate. */
export const long = (role: 'user' | 'assistant', n: number): HistoryMessage =>
  role === 'user'
    ? { role, content: `${n}`.padEnd(400, 'x'), at: n }
    : { role, content: `${n}`.padEnd(400, 'x'), toolCalls: [], at: n };

/** Five messages of about 100 tokens each, ending on a user message. */
export const history = (): HistoryMessage[] => [
  long('user', 1),
  long('assistant', 2),
  long('user', 3),
  long('assistant', 4),
  long('user', 5),
];

/** A provider that plays its turns in order and keeps every request. */
export function recording(turns: StreamEvent[][]) {
  const requests: ProviderRequest[] = [];
  const provider: Provider = {
    contextWindow: WINDOW,
    async *stream(request) {
      requests.push(request);
      yield* turns[requests.length - 1] ?? [];
    },
  };

  return { provider, requests };
}
