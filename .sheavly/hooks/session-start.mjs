// Once per run, tell the agent what a Cursor chat is told before its first prompt: where this
// repo's conventions are (the `sheavly` skill), and, when the opening prompt names no GitHub
// issue, the issue rule (`.cursor/hooks/require-issue.mjs`). Advisory: a Sheavly hook cannot
// refuse a prompt, so the issue rule is said, not enforced; the git guard still enforces the
// branch and commit formats.
import { CHAT_ID, CursorBridgeError, PROJECT_ROOT, runCursorHook } from './cursor-bridge.mjs';

const SKILL_POINTER =
  "This repository's conventions are the `sheavly` skill (.agents/skills/sheavly/SKILL.md), a router to one guide per topic: read the guide for what you are about to change. Extend the harness, never modify its core. Branches, commits and PRs follow the `git` skill.";

/** The text of the newest user message, or ''. */
function openingPrompt(messages) {
  const user = messages.findLast((message) => message.role === 'user');

  return typeof user?.content === 'string' ? user.content : '';
}

/** The hook, for a project in `root`; `env` and `hooksDir` let a test point it elsewhere. */
export function createSessionStartHook(options = {}) {
  const { root = PROJECT_ROOT, hooksDir, env, timeoutMs } = options;

  return {
    name: 'dev-session-start',
    sessionStart: async ({ messages, addContext, signal }) => {
      addContext(SKILL_POINTER);

      try {
        const answer = await runCursorHook({
          script: 'require-issue.mjs',
          input: {
            conversation_id: CHAT_ID,
            prompt: openingPrompt(messages),
            workspace_roots: [root],
          },
          root,
          hooksDir,
          env,
          timeoutMs,
          signal,
        });

        if (answer.continue === false) addContext(answer.user_message);
      } catch (caughtError) {
        if (!(caughtError instanceof CursorBridgeError)) throw caughtError;

        addContext(caughtError.message);
      }
    },
  };
}

export default createSessionStartHook();
