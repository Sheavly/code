// The git guard's rules for `gh stack` (the github/gh-stack extension). Stacked PRs are allowed:
// these only refuse the forms that would hang an agent (a prompt, an editor or a TUI), stage
// everything, or create a branch whose name the guard can't check.
import { BASE_BRANCH, BRANCH_EXAMPLE } from './git-workflow.utils.mjs';
import { flagValue, positionals } from './shell-parse.utils.mjs';

const STACK_COMMANDS = new Set([
  ...['init', 'add', 'checkout', 'rebase', 'modify', 'sync', 'push', 'submit', 'link', 'merge'],
  ...['view', 'unstack', 'up', 'down', 'top', 'bottom', 'trunk', 'switch', 'alias'],
]);

/**
 * Subcommands that hang without a flag or argument: what they need, and the message when it's
 * missing. Commands not listed run non-interactively as they are.
 */
const STACK_PROMPTS = {
  view: {
    passes: ({ has }) => has('--json', '--short', '-s'),
    fix: '`gh stack view` opens a TUI; use `gh stack view --json`.',
  },
  submit: {
    passes: ({ has }) => has('--auto'),
    fix: '`gh stack submit` opens an editor; use `gh stack submit --auto` (drafts), then set each title and body with `gh pr edit`.',
  },
  merge: {
    passes: ({ has }) => has('--yes'),
    fix: '`gh stack merge` opens a wizard; use `gh stack merge <pr> --yes --squash`.',
  },
  checkout: {
    passes: ({ rest }) => positionals({ args: rest }).length > 0,
    fix: '`gh stack checkout` opens a menu; pass a stack number, PR number or branch.',
  },
  switch: {
    passes: () => false,
    fix: '`gh stack switch` is menu-only; use `gh stack up|down|top|bottom` or `gh stack checkout <branch>`.',
  },
  modify: {
    passes: ({ has }) => has('--abort', '--continue'),
    fix: '`gh stack modify` is a TUI; reshape a stack with git (see the /git skill, stacks.md).',
  },
};

function checkStackInit(params) {
  const { rest, newBranches } = params;
  const names = positionals({ args: rest, valued: ['-b', '--base'] });

  if (names.length === 0) {
    return `\`gh stack init\` prompts without branch names: \`gh stack init --base ${BASE_BRANCH} ${BRANCH_EXAMPLE}\`.`;
  }

  const base = flagValue({ args: rest, flags: ['-b', '--base'] });

  if (base !== undefined && base !== BASE_BRANCH) {
    return `Stacks are based on ${BASE_BRANCH}: \`gh stack init --base ${BASE_BRANCH} ${names.join(' ')}\`.`;
  }

  newBranches.push(...names);

  return null;
}

function checkStackAdd(params) {
  const { rest, newBranches } = params;
  const stagesAll = rest.some(
    (arg) => /^-[a-zA-Z]*[Au]/.test(arg) || ['--all', '--update'].includes(arg),
  );

  if (stagesAll) {
    return '`gh stack add -A`/`-u` stages everything; stage named files with `git add <path>…`, commit, then `gh stack add <branch>`.';
  }

  const names = positionals({ args: rest, valued: ['-m', '--message'] });

  if (names.length === 0) {
    return `Name the layer: \`gh stack add ${BRANCH_EXAMPLE}\` (without a name it prompts or makes one up from the message).`;
  }

  newBranches.push(...names);

  return null;
}

/** Why a `gh stack` call would hang or slip past the branch rules, or null. Collects new branches. */
export function checkStack(params) {
  const { args, newBranches } = params;
  const [subcommand, ...rest] = args;

  if (!subcommand || args.some((arg) => arg === '--help' || arg === '-h')) return null;

  if (!STACK_COMMANDS.has(subcommand)) {
    return `\`gh stack ${subcommand}\` is not a known non-interactive command. See \`gh stack --help\`.`;
  }

  if (subcommand === 'init') return checkStackInit({ rest, newBranches });
  if (subcommand === 'add') return checkStackAdd({ rest, newBranches });

  const prompt = STACK_PROMPTS[subcommand];
  const has = (...flags) => rest.some((arg) => flags.includes(arg.split('=')[0]));

  return prompt && !prompt.passes({ has, rest }) ? prompt.fix : null;
}
