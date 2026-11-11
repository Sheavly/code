export function runCommandPrompts(params: { backgroundEnabled: boolean }): {
  description: string;
  command: string;
  cwd: string;
  background: string;
  backgroundKind: string;
} {
  const { backgroundEnabled } = params;

  return {
    description:
      'Run a command in the workspace root (or in `cwd`: a folder of the workspace or of a sibling git worktree), without a shell. Chain commands with | && || and ;; ' +
      'redirects (> <), $variables, `backticks`, parentheses and & are not supported, and inside ' +
      "double quotes so is $ (use 'single quotes'; a backslash before other characters is literal, " +
      'so grep -E \'a\\|b\' src and grep -E "a\\|b" src both pass a\\|b). The user is asked before ' +
      'an unapproved base command runs. A session or workspace grant covers all its options and arguments, ' +
      'including paths outside the workspace, secret files, editing/execution options and npx downloads. ' +
      'Examples: find, sed, git diff, npm run test, npx eslint. Chained commands are approved independently. ' +
      'There is no shell glob expansion. If the user skips a command, do not run it again; do what they say.' +
      (backgroundEnabled
        ? ' Set background: true for slow finite work; set backgroundKind: "service" for persistent servers or watchers. Do not poll background work.'
        : ''),
    command: 'The command to run, e.g. `git status`',
    cwd:
      'Folder to run in, absolute or relative to the workspace root (default: the root). ' +
      'It must be inside the workspace or a sibling git worktree of its repo.',
    background:
      'Return a task id immediately. Finite work keeps this prompt alive until its result is delivered. ' +
      'Finish independent work, then end your turn without tool calls to wait. Do not poll task_status.',
    backgroundKind:
      'With background: true, task is finite work (builds, tests, CI waits) whose result is required. ' +
      'Service is a persistent server or watcher that does not keep the prompt alive. Stop either with cancel_task.',
  };
}

/** Receives launch facts after the task has been started by runtime code. */
export function backgroundStartedPrompt(params: {
  taskId: string;
  command: string;
  backgroundKind: 'task' | 'service';
}): string {
  const { taskId, command, backgroundKind } = params;
  const started = `Started background task ${taskId}: $ ${command}\n`;

  if (backgroundKind === 'service') {
    return (
      started +
      'This service does not keep this prompt alive. Use task_status only to inspect readiness or diagnose a problem, not to wait for exit. Stop it with cancel_task when finished.'
    );
  }

  return (
    started +
    'This finite task keeps this prompt alive until its result is delivered automatically. Finish independent work, then end your turn without tool calls to wait. Do not poll task_status or repeat the command. Use cancel_task to stop it.'
  );
}
