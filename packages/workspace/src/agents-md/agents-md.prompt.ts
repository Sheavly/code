import { AGENTS_FILE } from './agents-md.constants.js';
import type { AgentsFile } from './agents-md.types.js';

/** Expects non-empty, trimmed file contents in applicability order, root first. */
export function renderAgentsInstructions(params: { files: readonly AgentsFile[] }): string {
  const { files } = params;
  const intro =
    `Project instructions from ${AGENTS_FILE} files. Each applies to its folder and everything ` +
    'below it; where they disagree, the more specific (later) one wins.';
  const sections = files.map((file) => `## ${file.path}\n\n${file.content}`);

  return [intro, ...sections].join('\n\n');
}
