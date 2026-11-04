// subagentStart: a subagent gets no sessionStart or beforeSubmitPrompt, so link its Task tool call
// (`subagent_id`) to the chat that made it (chat-links.utils.mjs); the subagent's own hooks name
// that call as `parent_tool_call_id`. Without both ids it can't be tied to that chat's issue,
// approvals or stop checks, so it is refused rather than started untracked.
import { linkFromToolCall, linkSubagent } from './chat-links.utils.mjs';
import { hookNow, readHookInput, respond, updateChatState } from './hooks.utils.mjs';

const input = await readHookInput();
const { subagent_id: subagentId, parent_conversation_id: parentId } = input;

if (subagentId && parentId) {
  // A subagent launching its own subagent may not have used a linking hook yet.
  linkFromToolCall(input);
  linkSubagent({ subagentId, parentId });
  // The parent's stop hook waits while this call has a start and no stop (record-subagent-stop).
  updateChatState({ conversationId: subagentId, subagentStartedAt: hookNow() });
  respond({ permission: 'allow' });
} else {
  respond({
    permission: 'deny',
    user_message:
      "subagentStart input has no subagent_id or parent_conversation_id, so the subagent couldn't be tied to this chat's issue",
  });
}
