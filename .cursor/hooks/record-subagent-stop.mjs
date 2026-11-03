// subagentStop: marks the Task tool call finished, so the parent's stop hook stops waiting for it
// (subagents.utils.mjs). The call is the subagent's handle in the hook records: subagentStart gave
// it as `subagent_id`, and this event names it the same way (or as `tool_call_id`). A stop whose id
// has no record is matched through `agent_transcript_path`, named for the subagent's own
// conversation, to the call that chat last ran under. Without either, the subagent counts as
// running only until its idle timeout, after which the parent's checks run and name it once.
import path from 'node:path';
import { getChatState, readHookInput, respond, updateChatState } from './hooks.utils.mjs';
import { endToolCall } from './subagents.utils.mjs';

function toolCallOfTranscript(transcriptPath) {
  if (typeof transcriptPath !== 'string') return null;
  const subagentChatId = path.basename(transcriptPath, path.extname(transcriptPath));
  const toolCallId = getChatState(subagentChatId)?.parentConversationId;

  return typeof toolCallId === 'string' ? toolCallId : null;
}

const input = await readHookInput();
const toolCallId = input.subagent_id ?? input.tool_call_id;

if (typeof toolCallId === 'string' && getChatState(toolCallId)) {
  // Unconditional: a subagent continuing on a follow-up stops again, later.
  updateChatState({ conversationId: toolCallId, subagentStoppedAt: Date.now() });
} else {
  const linkedToolCallId = toolCallOfTranscript(input.agent_transcript_path);

  if (linkedToolCallId) endToolCall({ toolCallId: linkedToolCallId, field: 'subagentStoppedAt' });
}

respond({});
