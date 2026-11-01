// CI gate for the git workflow's PR format (.cursor/skills/git/conventions.md). PRs land with a
// squash merge, so the title is the commit that reaches main, and the body's `Closes #123` is
// what links the PR to its issue and closes it on merge. The commits inside a PR are for review
// and aren't checked here; the git guard (.cursor/hooks/guard-git-workflow.mjs) checks agents'.
//
// Stacked PRs (.cursor/skills/git/stacks.md) pass too: a PR may be based on another issue branch
// rather than main, and a layer that doesn't finish its issue says `Part of #123` instead of
// closing it.
//
// Reads PR_TITLE, PR_BODY, PR_AUTHOR, BASE_REF and HEAD_REF from the environment.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_BRANCH,
  BRANCH_EXAMPLE,
  checkHeader,
  findClosingIssues,
  findPartOfIssues,
  getBranchIssue,
  listScopes,
} from '../.cursor/hooks/git-workflow.utils.mjs';

// Dependabot PRs bump dependencies no issue asks for; the header format still applies to them.
const DEPENDENCY_BOT_LOGIN = 'dependabot[bot]';
const DEPENDENCY_BOT_BRANCH_PREFIX = 'dependabot/';

function isDependencyBotPr(params) {
  const { author, headRef } = params;

  return author === DEPENDENCY_BOT_LOGIN && headRef.startsWith(DEPENDENCY_BOT_BRANCH_PREFIX);
}

const formatIssues = (issues) => issues.map((n) => `#${n}`).join(', ');

function checkIssueLink(params) {
  const { body, headRef } = params;
  const closes = findClosingIssues(body);
  const partOf = findPartOfIssues(body);
  const branchIssue = getBranchIssue(headRef);

  if (branchIssue === null) {
    return [`Branch \`${headRef}\` must be \`<issue>-<kebab-name>\`, e.g. \`${BRANCH_EXAMPLE}\`.`];
  }

  if (closes.length === 0 && partOf.length === 0) {
    return [
      'The PR body must link its issue on a line of its own: `Closes #123`, or `Part of #123` for a stack layer that leaves the issue open.',
    ];
  }

  if (![...closes, ...partOf].includes(branchIssue)) {
    return [
      `The branch is for #${branchIssue}, but the PR body links ${formatIssues([...closes, ...partOf])}.`,
    ];
  }

  return [];
}

/** A stacked PR is based on a lower layer: a conforming issue branch, not main. */
function checkBase(baseRef) {
  if (baseRef === BASE_BRANCH || getBranchIssue(baseRef) !== null) return [];

  return [
    `The PR is based on \`${baseRef}\`: base it on ${BASE_BRANCH}, or on the issue branch below it in a stack.`,
  ];
}

/** Every format problem in a PR's title, body and branches, as messages; [] when it conforms. */
export function findFormatProblems(params) {
  const { repoRoot, title, body, author, baseRef, headRef } = params;
  const headerProblems = checkHeader({ header: title, scopes: listScopes(repoRoot) }).map(
    (problem) => `PR title "${title}": ${problem}`,
  );

  if (isDependencyBotPr({ author, headRef })) return headerProblems;

  return [...headerProblems, ...checkBase(baseRef), ...checkIssueLink({ body, headRef })];
}

function readEnv(name) {
  const value = process.env[name];

  if (value === undefined) {
    throw new Error(`${name} is not set; this check runs on pull_request events.`);
  }

  return value;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const problems = findFormatProblems({
    repoRoot: path.resolve(import.meta.dirname, '..'),
    title: readEnv('PR_TITLE'),
    body: readEnv('PR_BODY'),
    author: readEnv('PR_AUTHOR'),
    baseRef: readEnv('BASE_REF'),
    headRef: readEnv('HEAD_REF'),
  });

  if (problems.length > 0) {
    console.error(
      `${problems.join('\n')}\n\nFormat and examples: .cursor/skills/git/conventions.md (stacks: stacks.md). Fix it with \`gh pr edit --title … --body-file … --base …\`.`,
    );
    process.exit(1);
  }

  console.log('PR title, body and branches follow the git workflow format.');
}
