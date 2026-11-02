// The architecture rules the postToolUse hook injects on a chat's first edit of harness source:
// "Backend only" (the harness emits typed events; UI code only when an issue asks for one) and
// "Where code goes" (which package or folder something new belongs in). Their text lives once, in
// the project skill's sections; this reads them from there, so the two never drift.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMissingPath, ProjectReadError } from './hooks.errors.mjs';
import { PROJECT_ROOT } from './hooks.utils.mjs';

const SKILL = '.cursor/skills/working-in-sheavly-harness/SKILL.md';
const BACKEND_ONLY = '## Backend only: typed events, no UI';

export const WHERE_CODE_GOES = '## Where code goes';

/** TypeScript source of a workspace (app or package), tests aside: where the rule applies. */
const HARNESS_SOURCE = /^(packages\/[^/]+\/)?src\/(?!.*__tests__\/).*\.ts$/;

/** True if `relative` (a `/`-separated path from the root) is harness source the rule covers. */
export function coveredByRule(relative) {
  return HARNESS_SOURCE.test(relative);
}

/** The section under `heading` in `markdown`, up to the next `## ` heading; null if absent. */
export function sectionOf(params) {
  const { markdown, heading } = params;
  const start = markdown.indexOf(`${heading}\n`);

  if (start === -1) return null;

  const end = markdown.indexOf('\n## ', start + heading.length);

  return markdown.slice(start, end === -1 ? undefined : end).trim();
}

/**
 * The skill's section under `heading` as injected context, introduced by `title`; null if the
 * skill or its section is missing (never block an edit).
 */
function skillSection(params) {
  const { heading, title } = params;
  const file = path.join(PROJECT_ROOT, SKILL);
  let markdown;

  try {
    markdown = readFileSync(file, 'utf8');
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return null; // no skill in this checkout: no rule to show

    // Advisory: shown in place of the rule, so the agent learns why it's missing.
    return new ProjectReadError({ file: SKILL, cause: caughtError }).message;
  }

  const section = sectionOf({ markdown, heading });

  return section && `${title} (from ${SKILL}):\n\n${section}`;
}

/** "Backend only" as injected context, or null if the skill lost its section. */
export function architectureRule() {
  return skillSection({ heading: BACKEND_ONLY, title: 'Architecture rule for this project' });
}

/** "Where code goes" as injected context, or null if the skill lost its section. */
export function whereCodeGoes() {
  return skillSection({ heading: WHERE_CODE_GOES, title: 'Where code goes in this project' });
}
