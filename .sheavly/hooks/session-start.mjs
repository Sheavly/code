// Once per run, tell the agent what a Cursor chat is told before its first prompt: where this
// repo's conventions are (the `sheavly` skill), and, when the opening prompt names no GitHub
// issue, the issue rule (`.cursor/hooks/require-issue.mjs`). Every later user prompt is scanned
// too, so an issue named mid-chat is registered for the git guard. Advisory: a Sheavly hook cannot
// refuse a prompt, so the issue rule is said, not enforced; the git guard still enforces the
// branch and commit formats.
import { CHAT_ID, CursorBridgeError, PROJECT_ROOT, runCursorHook } from './cursor-bridge.mjs';

const SKILL_POINTER =
  "This repository's conventions are the `sheavly` skill (.agents/skills/sheavly/SKILL.md), a router to one guide per topic: read the guide for what you are about to change. Extend the harness, never modify its core. Branches, commits and PRs follow the `git` skill.";

/**
 * The newest prompt a person typed, or undefined. Only the host marks those `origin: 'user'`.
 * `addContext` text (this hook's own messages, skills, notices), a sub-agent's task and a message
 * from another agent are user-role messages without it, and must never be scanned: a `#123` in
 * one would register an issue the user did not name. An `id` is not enough: a task has one.
 */
function latestTypedPrompt(messages) {
  const typed = messages.findLast(
    (message) => message.role === 'user' && message.origin === 'user',
  );

  return typeof typed?.content === 'string' ? typed : undefined;
}

/** The hook, for a project in `root`; `env` and `hooksDir` let a test point it elsewhere. */
export function createSessionStartHook(options = {}) {
  const { root = PROJECT_ROOT, hooksDir, env, timeoutMs } = options;
  // sessionStart sees only the opening prompt, so issues named in later prompts (a stack across
  // issues) are registered at beforeTurn. A turn after a tool call sees the same prompt again, so
  // each is scanned once, by id. The id is recorded only after a successful scan, so a script that
  // failed is retried on the next turn.
  let scannedId;

  async function scanPrompt({ messages, addContext, signal }) {
    const prompt = latestTypedPrompt(messages);

    // A seeded message may have no id: it is scanned every turn, which only costs a script run.
    if (prompt === undefined || (prompt.id !== undefined && prompt.id === scannedId)) return;

    try {
      const answer = await runCursorHook({
        script: 'require-issue.mjs',
        input: { conversation_id: CHAT_ID, prompt: prompt.content, workspace_roots: [root] },
        root,
        hooksDir,
        env,
        timeoutMs,
        signal,
      });

      scannedId = prompt.id;
      if (answer.continue === false) addContext(answer.user_message);
    } catch (caughtError) {
      if (!(caughtError instanceof CursorBridgeError)) throw caughtError;

      addContext(caughtError.message);
    }
  }

  return {
    name: 'dev-session-start',
    sessionStart: async (context) => {
      context.addContext(SKILL_POINTER);
      await scanPrompt(context);
    },
    beforeTurn: scanPrompt,
  };
}

export default createSessionStartHook();
