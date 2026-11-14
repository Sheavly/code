// Before `run_command` runs, apply the shell guard and the git guard a Cursor chat has
// (`.cursor/hooks/guard-shell-commands.mjs`, `guard-git-workflow.mjs`): a command that edits a
// project file past the edit tools, or breaks the git workflow, is blocked with the reason. After
// a foreground command, `record-shell-writes.mjs` compares the project with its snapshot and
// reports a workaround. The guards fail closed: anything but an explicit `allow`, or a guard that
// cannot run, blocks the command.
//
// What it does not cover: a command started with `background: true` (it returns at once, so there
// is nothing to compare when the tool returns); parallel commands, which share one snapshot state
// and may be blamed for each other's writes; and any run in a workspace that is not trusted, where
// no project hook loads at all.
import {
  CHAT_ID,
  CursorBridgeError,
  PROJECT_ROOT,
  runCursorHook,
  withAdvice,
} from './cursor-bridge.mjs';

const GUARDS = ['guard-shell-commands.mjs', 'guard-git-workflow.mjs'];

/** The hook, for a project in `root`; `env` and `hooksDir` let a test point it elsewhere. */
export function createShellGuardHook(options = {}) {
  const { root = PROJECT_ROOT, hooksDir, env, timeoutMs } = options;

  return {
    name: 'dev-shell-guard',
    aroundToolCall: async ({ call, next, signal }) => {
      if (call.name !== 'run_command') return next();

      const { command, cwd = root, background } = call.input ?? {};

      if (typeof command !== 'string' || typeof cwd !== 'string') {
        return {
          content: 'run_command was called without a command string; it was not run.',
          isError: true,
        };
      }

      const run = (script, input) =>
        runCursorHook({ script, input, root, hooksDir, env, timeoutMs, signal });
      const denied = await denial({ run, command, cwd });

      if (denied) return { content: denied, isError: true };

      const result = await next();

      // A background command has not run yet when `next` returns: nothing to compare.
      return background === true ? result : afterCommand({ run, command, cwd, result });
    },
  };
}

/** What a guard's answer says is wrong, or undefined when it explicitly allows the command. */
function reasonToDeny(answer) {
  if (answer.permission === 'allow') return undefined;

  // An empty message is still a deny: only an explicit allow runs the command.
  const given = [answer.agent_message, answer.user_message].find(
    (message) => typeof message === 'string' && message.trim() !== '',
  );

  return (
    given ??
    `A guard did not allow this command (it answered ${JSON.stringify(answer).slice(0, 200)}).`
  );
}

/** The reason the guards deny `command`, or undefined; a guard that cannot run denies it. */
async function denial(params) {
  const { run, command, cwd } = params;

  for (const script of GUARDS) {
    try {
      const reason = reasonToDeny(await run(script, { conversation_id: CHAT_ID, command, cwd }));

      if (reason !== undefined) return reason;
    } catch (caughtError) {
      if (!(caughtError instanceof CursorBridgeError)) throw caughtError;

      return `${caughtError.message}. The command was not run, because the guard could not check it.`;
    }
  }

  return undefined;
}

/** `result` with the workaround note the record hook gives, when the command changed project files. */
function afterCommand(params) {
  const { run, command, cwd, result } = params;

  return withAdvice({
    result,
    advise: async () => {
      const answer = await run('record-shell-writes.mjs', {
        conversation_id: CHAT_ID,
        cwd,
        tool_input: { command, cwd },
      });

      return answer.additional_context;
    },
  });
}

export default createShellGuardHook();
