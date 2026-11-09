import type { HistoryMessage } from '@sheavly/protocol/message/message.types';

/** A sub-agent's final reply: the last non-empty assistant text in its history. */
export function finalReply(messages: HistoryMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role === 'assistant' && message.content.trim()) return message.content;
  }

  return '(the sub-agent finished without a reply)';
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
