// CI gate for the git workflow's PR format (.agents/skills/git/conventions.md). PRs land with a
// squash merge, so the title is the commit that reaches main, and the body's `Closes #123` is
// what links the PR to its issue and closes it on merge. Its `## Harness impact` section says what
// enforces each new package or pattern, or `none: <reason>` (.agents/skills/git/harness.md).
//
// The commits inside a PR are for review and their format isn't checked here (the git guard,
// .cursor/hooks/guard-git-workflow.mjs, checks agents'), but their scopes are: each needs its
// `area/*` label on the PR's issue, so the labels say what the work really touched.
//
// Stacked PRs (.agents/skills/git/stacks.md) pass too: a PR may be based on another issue branch
// rather than main, and a layer that doesn't finish its issue says `Part of #123` instead of
// closing it.
//
// Reads PR_NUMBER, PR_TITLE, PR_BODY, PR_AUTHOR, BASE_REF and HEAD_REF from the environment, and
// the PR's commits and its issue's labels through `gh` (GH_TOKEN, GH_REPO).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_BRANCH,
  BRANCH_EXAMPLE,
  checkHeader,
  findClosingIssues,
  findPartOfIssues,
  getBranchIssue,
  headerArea,
  listScopes,
} from '../.cursor/hooks/git-workflow.utils.mjs';
import { readGhJson, runGh } from './gh.utils.mjs';

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

const HARNESS_IMPACT = '## Harness impact';
const NONE_LINE = /^none: \S/;

/**
 * The body's `## Harness impact` section (.agents/skills/git/harness.md): what enforces each new
 * package or pattern the PR adds, or `none: <reason>`. Missing, empty or a bare `none` fails.
 */
export function checkHarnessImpact(body) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === HARNESS_IMPACT);

  if (start === -1) {
    return [
      `The PR body needs a \`${HARNESS_IMPACT}\` section: what enforces each new package or pattern it adds, or \`none: <reason>\` (.agents/skills/git/harness.md).`,
    ];
  }

  const end = lines.findIndex((line, index) => index > start && /^#{1,2} /.test(line));
  const content = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*-\s*$/gm, '') // the template's empty bullet
    .trim();

  if (content === '') {
    return [
      `\`${HARNESS_IMPACT}\` is empty: list what enforces each trigger, or write \`none: <reason>\`.`,
    ];
  }

  if (/^none\b/i.test(content) && !NONE_LINE.test(content)) {
    return [`\`${HARNESS_IMPACT}\` says none without a reason: write \`none: <reason>\`.`];
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

  return [
    ...headerProblems,
    ...checkBase(baseRef),
    ...checkIssueLink({ body, headRef }),
    ...checkHarnessImpact(body),
  ];
}

/**
 * The area labels the PR's commits call for (one per scope, `area/tooling` for a commit without
 * one) that its issue lacks, as a message; [] when the issue has them all.
 */
export function findAreaProblems(params) {
  const { issue, labels, headers } = params;
  const needed = [...new Set(headers.map((header) => headerArea(header)).filter(Boolean))];
  const has = new Set(labels.map((label) => label.toLowerCase()));
  const missing = needed.filter((label) => !has.has(label.toLowerCase()));

  if (missing.length === 0) return [];

  return [
    `The commits touch ${missing.map((label) => `\`${label}\``).join(', ')}, but #${issue} isn't labelled with ${missing.length === 1 ? 'it' : 'them'}. Label the issue (\`gh issue edit ${issue} --add-label ${missing.join(',')}\`) and rerun this check.`,
  ];
}

/** The area problems of the PR `number`, read through `gh`; none when the branch names no issue. */
function readAreaProblems(params) {
  const { number, headRef } = params;
  const issue = getBranchIssue(headRef);

  if (issue === null) return [];

  const { commits } = readGhJson({ gh: runGh, args: ['pr', 'view', number, '--json', 'commits'] });
  const { labels } = readGhJson({
    gh: runGh,
    args: ['issue', 'view', String(issue), '--json', 'labels'],
  });

  return findAreaProblems({
    issue,
    labels: labels.map((label) => label.name),
    headers: commits.map((commit) => commit.messageHeadline),
  });
}

function readEnv(name) {
  const value = process.env[name];

  if (value === undefined) {
    throw new Error(`${name} is not set; this check runs on pull_request events.`);
  }

  return value;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const pr = {
    title: readEnv('PR_TITLE'),
    body: readEnv('PR_BODY'),
    author: readEnv('PR_AUTHOR'),
    baseRef: readEnv('BASE_REF'),
    headRef: readEnv('HEAD_REF'),
  };
  const problems = [
    ...findFormatProblems({ repoRoot: path.resolve(import.meta.dirname, '..'), ...pr }),
    ...(isDependencyBotPr(pr)
      ? []
      : readAreaProblems({ number: readEnv('PR_NUMBER'), headRef: pr.headRef })),
  ];

  if (problems.length > 0) {
    console.error(
      `${problems.join('\n')}\n\nFormat and examples: .agents/skills/git/conventions.md (stacks: stacks.md). Fix it with \`gh pr edit --title … --body-file … --base …\`.`,
    );
    process.exit(1);
  }

  console.log('PR title, body and branches follow the git workflow format.');
}
