// After a file tool changes a project file, run what a Cursor chat gets from its post-edit hook
// (`.cursor/hooks/lint-edited-file.mjs`): Prettier, ESLint, and the first-edit hints (the
// architecture rule, the workspace README, the skill and guide that govern the file). The report
// is appended to the tool's result, so the agent reads it where it made the edit. Unlike in a
// Cursor chat, Prettier only checks: a rewrite after the tool returned would leave the agent's
// copy of the file stale, so the report says to format it and re-read it.
import { CHAT_ID, PROJECT_ROOT, runCursorHook, withAdvice } from './cursor-bridge.mjs';

const FILE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file']);

/** The hook, for a project in `root`; `env` and `hooksDir` let a test point it elsewhere. */
export function createEditFeedbackHook(options = {}) {
  const { root = PROJECT_ROOT, hooksDir, env, timeoutMs } = options;

  return {
    name: 'dev-edit-feedback',
    aroundToolCall: async ({ call, next, signal }) => {
      const result = await next();

      if (!FILE_TOOLS.has(call.name) || result.isError) return result;

      const file = call.input?.path;

      if (typeof file !== 'string') return result;

      // Advisory, like the Cursor hook: the edit stands, and a script that cannot run is said.
      return withAdvice({
        result,
        advise: async () => {
          const answer = await runCursorHook({
            script: 'lint-edited-file.mjs',
            input: { conversation_id: CHAT_ID, tool_input: { path: file } },
            root,
            hooksDir,
            // Check only: a rewrite after the tool returned would make the agent's copy stale.
            env: { SHEAVLY_FORMAT_CHECK_ONLY: '1', ...env },
            timeoutMs,
            signal,
          });

          return answer.additional_context;
        },
      });
    },
  };
}

export default createEditFeedbackHook();
