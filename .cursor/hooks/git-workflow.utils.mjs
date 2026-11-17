// The git workflow's rules, shared by the issue gate (require-issue.mjs), the git guard
// (guard-git-workflow.mjs) and the CI format check (scripts/check-git-format.mjs). The /git skill
// documents the same rules with examples (.agents/skills/git/conventions.md). GitHub is the only
// tracker: work is a GitHub issue (`#123`), linked from branches, commits and PRs. A PR may be
// stacked on another issue branch (.agents/skills/git/stacks.md).
// Node built-ins and local files only: the CI format check runs this with no `npm ci`.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isMissingPath, ProjectReadError } from './hooks.errors.mjs';

export const NO_ISSUE = 'NO-ISSUE';
export const BASE_BRANCH = 'main';
const COMMIT_TYPES = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'test',
  'docs',
  'build',
  'ci',
  'chore',
  'revert',
];
const MAX_HEADER_LENGTH = 72;

export const BRANCH_EXAMPLE = '123-road-segment-export';
export const CHERRY_PICK_APPROVAL_EXAMPLE = 'allow cherry-pick';

// `#123`, or an issue URL (`…/issues/123`), anywhere in a prompt.
const ISSUES_IN_TEXT = /(?:^|[\s(,])#(\d+)\b|\/issues\/(\d+)\b/g;
const NO_ISSUE_PREFIX = new RegExp(String.raw`^\s*${NO_ISSUE}\b`, 'i');
// GitHub's own form (what `gh issue develop` and the issue's "Create a branch" suggest).
const BRANCH = /^(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()]+)\))?!?: (?<subject>.+)$/;
const REFS_TRAILER = /^Refs: #(\d+)$/m;
// GitHub's closing keywords, each alone on a line, so the merge closes the issue.
const CLOSING_LINE = /^(?:Closes|Fixes|Resolves) #(\d+)$/gim;
// A stack layer that doesn't finish its issue links it without closing it.
const PART_OF_LINE = /^Part of #(\d+)$/gim;
// Cherry-picking copies commits between branches, which is how two PRs end up with the same
// change, so the git guard only lets it through once the user has written this in the chat.
const CHERRY_PICK_APPROVAL = /\ballow(?:ed)?\s+(?:git\s+)?cherry[\s-]?pick(?:s|ing)?\b/i;

/** Every issue number a prompt names, in order, once each. */
export function findIssues(text) {
  const numbers = [...text.matchAll(ISSUES_IN_TEXT)].map((match) => Number(match[1] ?? match[2]));

  return [...new Set(numbers)];
}

export function isNoIssuePrompt(text) {
  return NO_ISSUE_PREFIX.test(text);
}

/** Whether a prompt explicitly allows cherry-picking for the rest of the chat. */
export function isCherryPickApproval(text) {
  return CHERRY_PICK_APPROVAL.test(text);
}

/** The issue of a conforming branch name (`123-road-segment-export` → 123), else null. */
export function getBranchIssue(name) {
  const match = BRANCH.exec(name);

  return match ? Number(match[1]) : null;
}

/** The folders in `dir` that hold a `package.json`: the workspaces there. */
function listWorkspaceFolders(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(path.join(dir, entry.name, 'package.json')))
      .map((entry) => entry.name);
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return []; // e.g. no apps/ folder yet: no scopes from it
    throw new ProjectReadError({ file: dir, cause: caughtError });
  }
}

/**
 * Valid commit scopes, read from disk so a new one needs no edit here: the folder of each
 * workspace in `packages/`, `extensions/` and `apps/` (`core`, `eslint-config`, `coding`, `terminal`). A folder with no
 * `package.json` yet (`apps/vscode`) isn't a workspace, so it isn't a scope.
 */
export function listScopes(repoRoot) {
  const scopes = [
    ...listWorkspaceFolders(path.join(repoRoot, 'packages')),
    ...listWorkspaceFolders(path.join(repoRoot, 'extensions')),
    ...listWorkspaceFolders(path.join(repoRoot, 'apps')),
  ];

  return [...new Set(scopes)].sort();
}

// Issue labels that say where work lives: one `area/<scope>` per commit scope, plus
// `area/tooling` for work without a scope (.cursor/, scripts/, .github/, root configs).
export const AREA_PREFIX = 'area/';
export const TOOLING_AREA = `${AREA_PREFIX}tooling`;

/** The area label of a commit scope; a commit without one is tooling. */
export function areaLabel(scope) {
  return scope === undefined ? TOOLING_AREA : `${AREA_PREFIX}${scope}`;
}

/** Every area label the repo should have, from the scopes on disk. */
export function listAreaLabels(repoRoot) {
  return [...listScopes(repoRoot).map((scope) => areaLabel(scope)), TOOLING_AREA].sort();
}

// GitHub compares label names without case (`Area/Core` is `area/core`), so these do too.
export const isAreaLabel = (name) => name.toLowerCase().startsWith(AREA_PREFIX);

/** The area label a commit header calls for (`feat(loop): …` → `area/loop`), or null off-format. */
export function headerArea(header) {
  const match = HEADER.exec(header);

  return match?.groups ? areaLabel(match.groups.scope) : null;
}

/** What is wrong with a `type(scope): subject` header, or [] when it conforms. */
export function checkHeader(params) {
  const { header, scopes } = params;
  const match = HEADER.exec(header);

  if (!match?.groups) return [`"${header}" is not \`type(scope): subject\`.`];

  const { type = '', scope, subject = '' } = match.groups;
  const problems = [];

  if (!COMMIT_TYPES.includes(type)) {
    problems.push(`type \`${type}\` is not one of ${COMMIT_TYPES.join(', ')}.`);
  }

  if (scope !== undefined && !scopes.includes(scope)) {
    problems.push(`scope \`${scope}\` is not a package or src/ folder (${scopes.join(', ')}).`);
  }

  if (/^[A-Z]/.test(subject)) problems.push('the subject starts with a capital letter.');
  if (subject.endsWith('.')) problems.push('the subject ends with a full stop.');

  if (header.length > MAX_HEADER_LENGTH) {
    problems.push(`the header is ${header.length} characters; the limit is ${MAX_HEADER_LENGTH}.`);
  }

  return problems;
}

/** The issue of a commit message's `Refs: #123` trailer, or null. */
function findRefsIssue(message) {
  const match = REFS_TRAILER.exec(message);

  return match ? Number(match[1]) : null;
}

/**
 * What is wrong with a whole commit message, or [] when it conforms: the header, and a
 * `Refs: #123` trailer naming `issue` (the branch's; null skips the comparison).
 */
export function checkCommitMessage(params) {
  const { message, scopes, issue, issueSource } = params;
  const problems = checkHeader({ header: message.split('\n')[0] ?? '', scopes });
  const refs = findRefsIssue(message);

  if (refs === null) problems.push('there is no `Refs: #123` trailer naming the issue.');
  else if (issue !== null && refs !== issue) {
    problems.push(`\`Refs: #${refs}\` but ${issueSource} is for #${issue}.`);
  }

  return problems;
}

/** The issues a PR body closes (`Closes #123` lines), in order. */
export function findClosingIssues(body) {
  return [...body.matchAll(CLOSING_LINE)].map((match) => Number(match[1]));
}

/** The issues a PR body links without closing (`Part of #123` lines: a stack layer). */
export function findPartOfIssues(body) {
  return [...body.matchAll(PART_OF_LINE)].map((match) => Number(match[1]));
}
