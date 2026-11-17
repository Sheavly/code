// Whether a chat's subagents are still working, for the stop hook: while one is, its edits are
// half done, so the parent's checks wait for the first turn end after the last one stopped. A
// subagent with a recorded start and no stop counts as running until nothing below it was recorded
// for SUBAGENT_IDLE_TIMEOUT_MS; then the checks run anyway and name it once, so a stop the hooks
// never saw (a crash, a lost event) can't hold them back forever.
import { chatFamily } from './chat-links.utils.mjs';
import { getChatState, listChatStates, updateChatState } from './chat-state.utils.mjs';
import { ChatLinkError } from './hooks.errors.mjs';
import { hookNow } from './hooks.utils.mjs';

const SUBAGENT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * What ends a Task tool call: its subagentStop; a later call resuming the same subagent (a resume
 * sends no subagentStop for the call it cuts short); or the stop hook having named it once as
 * silent past the timeout.
 */
const ENDED_AT_FIELDS = ['subagentStoppedAt', 'subagentSupersededAt', 'subagentDroppedAt'];

/** A tool call whose start was recorded after it last ended, if ever. */
function isOpen(state) {
  const startedAt = state?.subagentStartedAt;

  if (typeof startedAt !== 'number') return false;
  const endedAt = ENDED_AT_FIELDS.map((field) => state[field]).filter(
    (value) => typeof value === 'number',
  );

  return endedAt.length === 0 || Math.max(...endedAt) < startedAt;
}

/**
 * Records that an open Task tool call ended (`field` is one of ENDED_AT_FIELDS); a call with no
 * start, or one already ended, is left as it is, so an ended call's real stop time survives.
 */
export function endToolCall(params) {
  const { toolCallId, field, now = hookNow() } = params;

  if (!ENDED_AT_FIELDS.includes(field)) throw new ChatLinkError(`Unknown end of a call: ${field}`);
  if (!isOpen(getChatState(toolCallId))) return false;
  updateChatState({ conversationId: toolCallId, [field]: now });

  return true;
}

/** When anything below a tool call last happened: its start, or a hook call of its subagent. */
function lastActivity(params) {
  const { records, record } = params;
  let latest = record.state.subagentStartedAt;

  for (const child of chatFamily({ conversationId: record.id, records }).slice(1)) {
    const edits = Object.values(child.state?.editedFiles ?? {});

    latest = Math.max(latest, child.state?.lastActiveAt ?? 0, ...edits);
  }

  return latest;
}

/**
 * The subagents anywhere below a chat whose start was recorded and whose stop wasn't: `running`
 * while something below them happened within the timeout, `timedOut` after it. Each is the Task
 * tool call's id, the subagent's handle in the hook records.
 */
export function findOpenSubagents(params) {
  const { conversationId, now = hookNow() } = params;
  const records = listChatStates();
  const running = [];
  const timedOut = [];

  for (const record of chatFamily({ conversationId, records }).slice(1)) {
    if (!isOpen(record.state)) continue;
    const idleMs = now - lastActivity({ records, record });

    (idleMs < SUBAGENT_IDLE_TIMEOUT_MS ? running : timedOut).push(record.id);
  }

  return { running, timedOut };
}

/** The note naming subagents that went silent, after which they no longer hold the checks back. */
export function dropTimedOutSubagents(timedOut) {
  if (timedOut.length === 0) return null;

  for (const toolCallId of timedOut) endToolCall({ toolCallId, field: 'subagentDroppedAt' });

  return `Subagents ${timedOut.join(', ')} started but recorded no stop and nothing for ${SUBAGENT_IDLE_TIMEOUT_MS / 60_000} minutes, so these checks ran without waiting for them. If one is still working, its edits are checked when it finishes; tell the user in your answer.`;
}
