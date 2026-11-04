// Subagents (the Task tool) run under their own conversation id and get no sessionStart or
// beforeSubmitPrompt, so they have no issue, approval or stop check of their own. subagentStart
// (record-subagent.mjs) links the Task tool call to the chat that made it, each subagent's own id
// links to that call (every hook of a subagent names it as `parent_tool_call_id`), and these
// readers walk the links at read time, so nested subagents work and nothing goes stale.
import { chatEditedFiles } from './chat-files.utils.mjs';
import { ChatLinkError } from './hooks.errors.mjs';
import {
  chatStateId,
  getChatState,
  hookNow,
  listChatStates,
  updateChatState,
} from './hooks.utils.mjs';
import { endToolCall } from './subagents.utils.mjs';

export function linkSubagent(params) {
  const { subagentId, parentId } = params;

  if (subagentId === parentId) {
    throw new ChatLinkError(`Chat ${subagentId} can't be its own parent`);
  }

  updateChatState({ conversationId: subagentId, parentConversationId: parentId });
}

/**
 * Links a subagent's own conversation id to the Task tool call that launched it, and records when
 * it was last seen working (the parent's stop hook waits while that is recent). Linking through
 * the call rather than copying its parent means a resumed subagent (a new tool call) follows the
 * latest link. A no-op for a chat that isn't a subagent.
 */
export function linkFromToolCall(input) {
  const chatId = input.conversation_id ?? input.session_id;
  const toolCallId = input.parent_tool_call_id;

  if (!chatId || typeof toolCallId !== 'string' || toolCallId === chatId) return;
  updateChatState({ conversationId: chatId, lastActiveAt: hookNow() });
  const previousToolCallId = getChatState(chatId)?.parentConversationId;

  if (previousToolCallId === toolCallId) return;
  linkSubagent({ subagentId: chatId, parentId: toolCallId });

  // A resume sends no subagentStop for the call it replaces, which would otherwise count as
  // running until the idle timeout.
  if (previousToolCallId) {
    endToolCall({ toolCallId: previousToolCallId, field: 'subagentSupersededAt' });
  }
}

/**
 * What a chat works under: the first issues (or NO-ISSUE) up its chain of parents, and a
 * cherry-pick approval given anywhere on it, so a subagent's git commands answer to its parent's.
 */
export function chatWorkflow(conversationId) {
  const seen = new Set();
  let allowCherryPick = false;

  for (let id = conversationId; id;) {
    if (seen.has(id)) throw new ChatLinkError(`Chat links loop through ${id}`);
    seen.add(id);
    const state = getChatState(id);

    if (!state) break;
    allowCherryPick ||= state.allowCherryPick === true;

    if (state.issues?.length > 0 || state.noIssue) {
      return { issues: state.issues ?? [], noIssue: state.noIssue === true, allowCherryPick };
    }

    id = state.parentConversationId;
  }

  return { issues: [], noIssue: false, allowCherryPick };
}

/**
 * A chat and every chat linked below it (its subagents' Task tool calls and the subagents'
 * own conversations, nested ones included), as `{ id, state }`, the chat itself first.
 */
export function chatFamily(params) {
  const { conversationId, records = listChatStates() } = params;
  const family = [{ id: chatStateId(conversationId), state: getChatState(conversationId) }];

  for (let index = 0; index < family.length; index += 1) {
    const { id } = family[index];
    const children = records.filter(({ state }) => {
      const parent = state?.parentConversationId;

      return typeof parent === 'string' && chatStateId(parent) === id;
    });

    for (const child of children) {
      if (!family.some((member) => member.id === child.id)) family.push(child);
    }
  }

  return family;
}

/**
 * What a chat and its subagents did in the checkout, for the stop hook: whether any of them edited
 * it, every file they edited (null when one of them edited before files were recorded), the shell
 * workarounds each used (with the `chat` that ran it), and the conversation ids of them all.
 */
export function familyWork(conversationId) {
  const family = chatFamily({ conversationId });
  const editors = family.filter(({ state }) => state?.editedProjectSource === true);
  const fileLists = editors.map(({ state }) => chatEditedFiles(state));
  const files = fileLists.includes(null) ? null : [...new Set(fileLists.flat())].sort();

  return {
    edited: editors.length > 0,
    files,
    unguardedCommands: family.flatMap(({ id, state }) => {
      return (state?.unguardedCommands ?? []).map((entry) => ({ ...entry, chat: id }));
    }),
    ids: family.map(({ id }) => id),
  };
}
