import type { HistoryMessage, ToolMessage } from '@sheavly/protocol/message/message.types';
import type { SkillInfo } from '@sheavly/protocol/skill/skill.types';
import type { StoredConversation } from '@sheavly/protocol/store/store.types';
import { INTERRUPTED_CALL } from './conversations.constants.js';

/** Whether `stored`'s title has `search`, ignoring case. */
export function matchesTitle(params: { stored: StoredConversation; search: string }): boolean {
  const { stored, search } = params;

  return stored.title.toLowerCase().includes(search.toLowerCase());
}

/** Whether `skill` matches `search`: its name or description has it, ignoring case. */
export function matchesSearch(params: { skill: SkillInfo; search: string }): boolean {
  const { skill, search } = params;
  const wanted = search.toLowerCase();

  return (
    skill.name.toLowerCase().includes(wanted) || skill.description.toLowerCase().includes(wanted)
  );
}

/**
 * History a model can be continued from after the process ended mid-run: every tool call has a
 * result. A call with none gets a placeholder (an error, saying it returned nothing) right after
 * the results that did arrive, in the assistant message's call order, stamped `at`. History that
 * is already valid comes back unchanged.
 */
export function repairHistory(params: {
  messages: readonly HistoryMessage[];
  at: number;
}): HistoryMessage[] {
  const { messages, at } = params;
  const repaired: HistoryMessage[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];

    if (message === undefined) break;
    repaired.push(message);
    index++;

    if (message.role !== 'assistant') continue;

    // The tool results that follow the assistant message, up to the next message of another role.
    const results: ToolMessage[] = [];

    for (let next = messages[index]; next?.role === 'tool'; next = messages[index]) {
      results.push(next);
      index++;
    }

    const answered = new Set(results.map((result) => result.toolCallId));
    const missing = message.toolCalls.filter((call) => !answered.has(call.id));

    repaired.push(...results, ...missing.map((call) => placeholder({ callId: call.id, at })));
  }

  return repaired;
}

function placeholder(params: { callId: ToolMessage['toolCallId']; at: number }): ToolMessage {
  return {
    role: 'tool',
    toolCallId: params.callId,
    content: INTERRUPTED_CALL,
    isError: true,
    at: params.at,
  };
}
