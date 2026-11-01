// beforeSubmitPrompt: a chat names its GitHub issue before the agent starts, so branches, commits
// and PRs can be tied to it. Remembered per conversation, so only the first prompt needs it. Being
// on an issue branch (`123-road-segment-export`) names it too. A later prompt naming more issues
// adds them, so one chat can work a stack of PRs across issues. NO-ISSUE opts out explicitly; Ask
// mode can't change anything. Also records "allow cherry-pick" for the git guard.
import {
  findIssues,
  getBranchIssue,
  isCherryPickApproval,
  isNoIssuePrompt,
} from './git-workflow.utils.mjs';
import {
  currentBranch,
  getChatState,
  readHookInput,
  runGuard,
  updateChatState,
} from './hooks.utils.mjs';

/** The hook's decision: continue, or stop and ask for the chat's issue. */
async function decide() {
  const input = await readHookInput();
  const conversationId = input.conversation_id;
  const prompt = input.prompt ?? '';
  const state = getChatState(conversationId);
  const known = state?.issues ?? [];

  if (isCherryPickApproval(prompt)) updateChatState({ conversationId, allowCherryPick: true });

  if (input.composer_mode === 'ask') return { continue: true };

  if (known.length === 0 && !state?.noIssue && isNoIssuePrompt(prompt)) {
    updateChatState({ conversationId, noIssue: true });

    return { continue: true };
  }

  const branch = currentBranch(input.workspace_roots?.[0]);
  const branchIssue = branch ? getBranchIssue(branch) : null;
  const named = [...findIssues(prompt), ...(branchIssue === null ? [] : [branchIssue])];
  const issues = [...new Set([...known, ...named])];

  if (issues.length > 0) {
    if (issues.length !== known.length) updateChatState({ conversationId, issues });

    return { continue: true };
  }

  if (state?.noIssue) return { continue: true };

  return {
    continue: false,
    user_message:
      'Name the GitHub issue for this chat first, e.g. "#123: add road segment export" (several for a stack: "#123 and #124"), or check out its branch. For work without an issue, start the prompt with NO-ISSUE.',
  };
}

await runGuard({
  guard: 'require-issue',
  check: decide,
  deny: (reason) => ({ continue: false, user_message: reason }),
});
