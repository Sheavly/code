import path from 'node:path';
import { renderAgentsInstructions } from './agents-md.prompt.js';
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
  const present = files
    .filter((file) => file.content.trim() !== '')
    .map((file) => ({ ...file, content: file.content.trim() }));

  if (present.length === 0) return undefined;

  return renderAgentsInstructions({ files: present });
}
