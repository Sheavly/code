import type { ContextState } from '@sheavly/core/hook/hook.types';
import type { TransientNotice } from '@sheavly/protocol/notice/notice.types';
import { contextWindowSchema } from '@sheavly/protocol/model/model.validator';
import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';

/**
 * The context's state from the provider's window and the session's last call. What the last call
 * used is its input plus its output, which becomes input on the next turn: what the model saw,
 * not a running total. A window that isn't a valid size (a provider a host wrote may report 0 or
 * NaN) is treated as unknown: it would otherwise reach the stored stream, which refuses it on
 * read, and the conversation could no longer be reopened.
 */
export function contextState(params: {
  window: number | undefined;
  lastTokens: TokenUsage | undefined;
}): ContextState {
  const { lastTokens } = params;
  const window = contextWindowSchema.safeParse(params.window).success ? params.window : undefined;

  return {
    window,
    used: lastTokens && lastTokens.inputTokens + lastTokens.outputTokens,
  };
}

/**
 * Transient context telemetry for the provider to format, or undefined when nothing is known.
 * The snapshot has already been validated by `contextState`; no model-facing wording lives here.
 */
export function contextNotice(state: ContextState): TransientNotice | undefined {
  const { window, used } = state;

  if (window !== undefined) return { kind: 'context-usage', context: { window, used } };

  if (used !== undefined) return { kind: 'context-usage', context: { used } };

  return undefined;
}
