import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { Script } from './provider.types.js';

/**
 * Picks the step for a request: each session's first user message names its script, and the
 * step is the next one for that session (the last repeats). Shared by the routed providers.
 */
export function createStepPicker<TStep>(scripts: Record<string, TStep[]>) {
  const turns = new Map<string, number>();

  return (request: ProviderRequest): { script: string; step: TStep | undefined } => {
    const first = request.messages.find((m) => m.role === 'user')?.content ?? '';
    const steps = scripts[first];

    if (!steps) throw new Error(`No script for "${first}"`);
    const turn = turns.get(first) ?? 0;

    turns.set(first, turn + 1);

    return { script: first, step: steps[Math.min(turn, steps.length - 1)] };
  };
}

/**
 * Test-only provider whose reply depends on the request: each session's first user message picks
 * its script, and the script sees how many replies that session already got. Lets one provider
 * drive the main session and every sub-agent.
 */
export function routedProvider(scripts: Record<string, Script[]>): Provider {
  const pick = createStepPicker(scripts);

  return {
    async *stream(request: ProviderRequest) {
      yield* (pick(request).step ?? (() => []))(request);
    },
  };
}

/** A tool call event, with the call description the harness requires. `id` is branded here. */
export function toolCall(params: {
  id: string;
  name: string;
  input: Record<string, unknown>;
}): StreamEvent {
  const { id, name, input } = params;

  return {
    type: 'tool_call',
    call: { id: callIdSchema.parse(id), name, input: { description: `${name} ${id}`, ...input } },
  };
}

/** A script step that answers with text and ends the turn. */
export function say(text: string): Script {
  return () => [
    { type: 'text_delta', text },
    { type: 'done', stopReason: 'end_turn' },
  ];
}

/** A script step that calls tools. */
export function calls(...events: StreamEvent[]): Script {
  return () => [...events, { type: 'done', stopReason: 'tool_use' }];
}
