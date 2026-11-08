import type { ContextState } from '@sheavly/core/hook/hook.types';
import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';

const count = new Intl.NumberFormat('en-US');

/**
 * The context's state from the provider's window and the session's last call. What the last call
 * used is its input plus its output, which becomes input on the next turn: what the model saw,
 * not a running total.
 */
export function contextState(params: {
  window: number | undefined;
  lastTokens: TokenUsage | undefined;
}): ContextState {
  const { window, lastTokens } = params;

  return {
    window,
    used: lastTokens && lastTokens.inputTokens + lastTokens.outputTokens,
  };
}

/**
 * The one short line that tells the agent how full its context is, or undefined when nothing is
 * known. It shrinks to what is known: before the first call only the window, and with no window
 * only what was used.
 */
export function contextNotice(state: ContextState): string | undefined {
  const { window, used } = state;

  if (window !== undefined && used !== undefined) {
    const percent = Math.round((used / window) * 100);

    return `Context: ${count.format(used)} of ${count.format(window)} tokens used (${String(percent)}%)`;
  }

  if (window !== undefined) return `Context: ${count.format(window)} token window`;

  if (used !== undefined) return `Context: ${count.format(used)} tokens used`;

  return undefined;
}
