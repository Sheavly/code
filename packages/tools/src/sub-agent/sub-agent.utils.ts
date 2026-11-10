import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { NO_REPLY } from './sub-agent.constants.js';

/**
 * What a sub-agent reported: its final answer, whole. That is the unbroken run of assistant
 * messages that ends its last reply, joined in order with nothing between them, because after an
 * output-limit cut the continuation resumes mid-text. Anything before a tool call, a tool result
 * or another entry is work in progress, not the report. An empty one is skipped, and a history
 * with no reply gives a placeholder, so a parent never gets a blank result.
 */
export function finalReply(messages: readonly HistoryMessage[]): string {
  // A message that made tool calls is work in progress, never the report: a run that ended right
  // after a tool result has no reply, and the walk back below stops before such a message too.
  const last = messages.findLastIndex(
    (message) => isTextOnlyReply(message) && message.content.trim(),
  );

  if (last === -1) return NO_REPLY;

  let first = last;

  while (isTextOnlyReply(messages[first - 1])) first -= 1;

  return messages
    .slice(first, last + 1)
    .filter(isTextOnlyReply)
    .map((message) => message.content)
    .join('');
}

function isTextOnlyReply(
  message: HistoryMessage | undefined,
): message is Extract<HistoryMessage, { role: 'assistant' }> {
  return message?.role === 'assistant' && message.toolCalls.length === 0;
}

/** Shared base, child role, then child extras. Blank sections are skipped. */
export function subAgentInstructions(params: {
  rules: string;
  base?: string | undefined;
  extra?: string | undefined;
}): string {
  const { rules, base = '', extra = '' } = params;

  return [base, rules, extra]
    .map((section) => section.trim())
    .filter(Boolean)
    .join('\n\n');
}
