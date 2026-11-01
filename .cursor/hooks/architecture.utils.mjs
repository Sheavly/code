// The architecture rule the postToolUse hook injects: the harness is a backend that emits typed
// events, and UI code is written only when an issue asks for one. Its text lives once, in the
// project skill's "Backend only" section; this reads it from there, so the two never drift.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './hooks.utils.mjs';

const SKILL = '.cursor/skills/working-in-sheavly-harness/SKILL.md';
const HEADING = '## Backend only: typed events, no UI';

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

/** The rule as injected context, or null if the skill lost its section (never block an edit). */
export function architectureRule() {
  try {
    const section = sectionOf({
      markdown: readFileSync(path.join(PROJECT_ROOT, SKILL), 'utf8'),
      heading: HEADING,
    });

    return section && `Architecture rule for this project (from ${SKILL}):\n\n${section}`;
  } catch {
    return null;
  }
}
