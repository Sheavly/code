import type { Harness } from '@sheavly/host/host/host.types';
import type { ContextUsage } from '@sheavly/protocol/usage/usage.types';

/** Uses restored session tokens and the active provider's configured window, including after a switch. */
export function conversationContextUsage(params: {
  harness: Harness;
  throughSeq: number;
}): ContextUsage {
  const { harness, throughSeq } = params;
  const tokens = harness.sessions.lastTokens(harness.mainSession.id);
  const window = harness.provider.contextWindow;

  return {
    throughSeq,
    ...(tokens && {
      used: tokens.inputTokens + tokens.outputTokens,
      cached: tokens.cacheReadTokens,
    }),
    ...(window !== undefined && { window }),
  };
}
