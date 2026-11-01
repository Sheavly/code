import type { Message } from '@sheavly/core/message/message.types';

/** A sub-agent's final reply: the last non-empty assistant text in its history. */
export function finalReply(messages: Message[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role === 'assistant' && message.content.trim()) return message.content;
  }

  return '(the sub-agent finished without a reply)';
}

/** The system instructions a sub-agent gets: the built-in rules, then the parent's extras. */
export function subAgentInstructions(params: {
  rules: string;
  extra?: string | undefined;
}): string {
  const { rules, extra } = params;

  return extra?.trim() ? `${rules}\n\n${extra.trim()}` : rules;
}
