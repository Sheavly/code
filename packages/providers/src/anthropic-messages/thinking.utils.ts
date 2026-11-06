import type { MessagesProviderConfig } from './messages.types.js';

/** Adaptive thinking chooses its own budget; it must not receive budget_tokens. */
export function thinkingFor(
  config: Pick<MessagesProviderConfig, 'thinkingMode' | 'thinkingBudget'>,
) {
  if (config.thinkingMode === 'adaptive') return { type: 'adaptive' } as const;
  if (config.thinkingMode === 'disabled') return { type: 'disabled' } as const;

  if (config.thinkingBudget !== undefined) {
    return { type: 'enabled', budget_tokens: config.thinkingBudget } as const;
  }

  return undefined;
}
