// What the git guard denies, one check per rule. Each takes
// the words of one git/gh command and returns why it breaks the workflow, or null.
import { flagValue } from './shell-parse.utils.mjs';
import {
  BRANCH_EXAMPLE,
  CHERRY_PICK_APPROVAL_EXAMPLE,
  getBranchIssue,
  NO_ISSUE,
} from './git-workflow.utils.mjs';

const GIT_GLOBAL_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const WHOLE_TREE_PATHS = new Set(['.', './', '*', ':', ':/']);
const BRANCH_LIST_FLAGS =
  /^(-d|-D|--delete|-l|--list|-a|--all|-r|--remotes|-v+|--verbose|--show-current|--contains|--no-contains|--merged|--no-merged|--points-at|--edit-description|--unset-upstream|-u|--set-upstream-to.*)$/;
const BRANCH_RENAME_FLAGS = new Set(['-m', '-M', '--move', '-c', '-C', '--copy']);

const STAGING_FIX =
  'Stage named files only (`git add <path>…`, `git add -p <path>`), so a commit holds just its scope. See the /git skill (commit.md).';
const FORCE_PUSH_FIX =
  'Push a rewritten branch with `git push --force-with-lease` (or `gh stack push`): only while its PR is a draft, or to restack a layer onto the branch below it; `--force` would overwrite what others pushed. See the /git skill (fix.md, stacks.md).';
const PR_MERGE_FIX =
  'PRs land squashed: `gh pr merge <n> --squash`, or `gh stack merge <pr> --yes --squash` for a stack. The PR title becomes its one commit on main. See the /git skill (merge.md).';
const CHERRY_PICK_FIX = `Cherry-picking copies commits between branches, so it needs the user's explicit approval in this chat: ask them, naming the commits and the target branch, and they reply "${CHERRY_PICK_APPROVAL_EXAMPLE}". To fix an earlier commit in the same PR, use the /git skill's fix.md instead.`;

/** The subcommand and its args, past git's global options (`git -C dir commit …`). */
function splitGitArgs(args) {
  const start = args.findIndex((arg, index) => {
    return !arg.startsWith('-') && !GIT_GLOBAL_VALUED.has(args[index - 1] ?? '');
  });

  return start === -1
    ? { subcommand: null, rest: [] }
    : { subcommand: args[start], rest: args.slice(start + 1) };
}

/** Short option clusters (`-Am`) and the long option, for one flag letter. */
function hasFlag(params) {
  const { args, letter, long } = params;

  return args.some((arg) => arg === long || (/^-[a-zA-Z]+$/.test(arg) && arg.includes(letter)));
}

/** Why a git invocation would stage more than named files, or null. */
export function checkStaging(args) {
  const { subcommand, rest } = splitGitArgs(args);

  if (subcommand === 'add') {
    const stagesAll =
      hasFlag({ args: rest, letter: 'A', long: '--all' }) ||
      hasFlag({ args: rest, letter: 'u', long: '--update' }) ||
      rest.some((arg) => WHOLE_TREE_PATHS.has(arg));

    return stagesAll ? `\`git add ${rest.join(' ')}\` stages everything. ${STAGING_FIX}` : null;
  }

  if (subcommand === 'commit' && hasFlag({ args: rest, letter: 'a', long: '--all' })) {
    return `\`git commit -a\` stages every tracked change. ${STAGING_FIX}`;
  }

  return null;
}

/** Why a `git push` would overwrite the remote unchecked, or null. */
export function checkPush(args) {
  const { subcommand, rest } = splitGitArgs(args);

  if (subcommand !== 'push') return null;

  const isBareForce =
    hasFlag({ args: rest, letter: 'f', long: '--force' }) ||
    rest.some((arg) => /^\+[^+]/.test(arg));

  return isBareForce ? FORCE_PUSH_FIX : null;
}

/** Why a `git cherry-pick` must wait for the user's approval, or null. */
export function checkCherryPick(params) {
  const { args, allowCherryPick } = params;
  const { subcommand, rest } = splitGitArgs(args);

  if (subcommand !== 'cherry-pick') return null;
  // Finishing or abandoning a pick already under way changes nothing new.
  if (rest.some((arg) => ['--abort', '--quit', '--skip', '--continue'].includes(arg))) return null;

  return allowCherryPick ? null : CHERRY_PICK_FIX;
}

/** Why a `gh pr merge` would land a PR other than squashed, or null. */
export function checkPrMerge(args) {
  if (args.includes('--help') || args.includes('-h')) return null;

  return hasFlag({ args, letter: 's', long: '--squash' }) ? null : PR_MERGE_FIX;
}

const SWITCH_CREATE_FLAGS = ['-c', '-C', '--create', '--force-create', '--orphan'];

/** Branch names a git invocation would create. */
export function gitNewBranches(args) {
  const { subcommand, rest } = splitGitArgs(args);
  const created = (flags) => [flagValue({ args: rest, flags })].filter(Boolean);

  if (subcommand === 'checkout') return created(['-b', '-B', '--orphan']);
  if (subcommand === 'switch') return created(SWITCH_CREATE_FLAGS);
  if (subcommand === 'worktree' && rest[0] === 'add') return created(['-b', '-B']);
  if (subcommand !== 'branch' || rest.some((arg) => BRANCH_LIST_FLAGS.test(arg))) return [];

  const names = rest.filter((arg) => !arg.startsWith('-'));

  return rest.some((arg) => BRANCH_RENAME_FLAGS.has(arg)) ? names.slice(-1) : names.slice(0, 1);
}

/** Branch names `gh issue develop` would create (`--name <branch>`). */
export function ghNewBranches(args) {
  if (args[0] !== 'issue' || args[1] !== 'develop') return [];

  return [flagValue({ args, flags: ['-n', '--name'] })].filter(Boolean);
}

/** Why a new branch name breaks the format or belongs to an issue the chat doesn't work on, or null. */
export function checkBranch(params) {
  const { name, chatIssues, noIssue } = params;
  const issue = getBranchIssue(name);

  if (issue === null) {
    return `Branch \`${name}\` must be \`<issue>-<kebab-name>\`, e.g. \`${BRANCH_EXAMPLE}\`.`;
  }

  if (chatIssues.includes(issue)) return null;

  if (chatIssues.length === 0) {
    return noIssue
      ? `This chat started with ${NO_ISSUE}, so it can't create branches. Name the GitHub issue (\`#${issue}\`) in a prompt first.`
      : `No issue is recorded for this chat, so \`${name}\` can't be checked. Ask the user to name the GitHub issue (\`#123\`).`;
  }

  const list = chatIssues.map((n) => `#${n}`).join(', ');

  return `\`${name}\` is for #${issue}, but this chat works on ${list}. Use one of those, or ask the user to name #${issue} in a prompt (a stack can span several issues).`;
}
