import path from 'node:path';
import { AGENTS_FILE } from './agents-md.constants.js';
import type { AgentsFile } from './agents-md.types.js';
import { AgentsMdError } from '../errors/agents-md.errors.js';
import { isInside } from '../workspace/workspace.utils.js';

/**
 * The folders to look in, from `root` down to `cwd` (both included), like git walks up from the
 * working directory but in reading order: the general (root) file first, the most specific last.
 * Throws if `cwd` is outside `root`.
 */
export function agentsDirs(params: { root: string; cwd: string }): string[] {
  const root = path.resolve(params.root);
  const cwd = path.resolve(params.cwd);

  if (!isInside({ folder: root, target: cwd })) throw new AgentsMdError({ root, cwd });

  const relative = path.relative(root, cwd);

  const dirs = [root];

  for (const part of relative.split(path.sep).filter(Boolean)) {
    dirs.push(path.join(dirs.at(-1) ?? root, part));
  }

  return dirs;
}

/**
 * The system instructions for the found files, root first, each under its path so the model
 * knows which part of the tree it governs. Non-empty content is included in full, trimmed.
 */
export function formatAgentsInstructions(params: { files: AgentsFile[] }): string | undefined {
  const { files } = params;
  const present = files.filter((file) => file.content.trim() !== '');

  if (present.length === 0) return undefined;

  const intro =
    `Project instructions from ${AGENTS_FILE} files. Each applies to its folder and everything ` +
    'below it; where they disagree, the more specific (later) one wins.';
  const sections = present.map((file) => `## ${file.path}\n\n${file.content.trim()}`);

  return [intro, ...sections].join('\n\n');
}
