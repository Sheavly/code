import type {
  WorkingRootInfo,
  WorkingRootState,
} from '@sheavly/workspace/working-root/working-root.types';

export const WORKING_ROOT_PROMPTS = {
  description:
    'Choose the folder you work from, such as the git worktree of the task you are on. Relative ' +
    'paths in the file tools, grep, glob and run_command (its cwd) then start there, so you can ' +
    'write `packages/host/src/a.ts` instead of `../repo-branch/packages/host/src/a.ts`. It does not ' +
    "move the user's terminal, and it does not confine you: absolute paths and `../` still work " +
    'where the workspace allows them. The folder must be a git repository or worktree; the branch ' +
    'is read from git. Call it again to switch, or without a path to go back to the workspace root.',
  path: 'Folder to work from, absolute or relative to the workspace root. Omit it to clear the working root.',
} as const;

const MAX_BRANCH_LABEL = 80;

/**
 * The branch as the agent reads it: its name, or a note that HEAD is detached. The name comes
 * from a repo the agent chose, so it is data: kept to one short line, never an instruction.
 */
function branchLabel(branch: string | undefined): string {
  if (branch === undefined) return 'detached HEAD';

  const oneLine = branch.replace(/\s+/g, ' ').trim();

  return `branch ${oneLine.length > MAX_BRANCH_LABEL ? `${oneLine.slice(0, MAX_BRANCH_LABEL)}…` : oneLine}`;
}

/**
 * What the agent is told every turn about its working root, so it still knows after a summary or
 * a restart: the folder and branch and what resolves against it, or that the folder is gone and
 * must be replaced. `undefined` while none was ever set.
 */
export function renderWorkingRootNote(state: WorkingRootState): string | undefined {
  if (state.kind === 'unset') return undefined;

  if (state.kind === 'gone') {
    return [
      `Working root: ${state.root} can no longer be used (${state.reason}).`,
      'File tools and run_command refuse relative paths until you call set_working_root with a folder, or without a path to go back to the workspace root.',
    ].join('\n');
  }

  return [
    `Working root: ${state.info.root} (${branchLabel(state.info.branch)})`,
    'Relative paths in the file tools, grep and glob, and the cwd of run_command, start here. ' +
      'Use paths relative to it. Call set_working_root to switch, or without a path to clear it.',
  ].join('\n');
}

/** The tool's answer after the root was set, or cleared when `info` is undefined. */
export function renderWorkingRootResult(info: WorkingRootInfo | undefined): string {
  if (info === undefined) {
    return 'Working root cleared. Relative paths start at the workspace root again.';
  }

  return `Working root set to ${info.root} (${branchLabel(info.branch)}). Relative paths and command folders start there now.`;
}
