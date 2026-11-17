import path from 'node:path';
import type { InstructionSource } from '@sheavly/core/instruction-context/instruction-source.types';
import { AGENTS_FILE } from './agents-md.constants.js';
import type { AgentsFile, AgentsMdHookOptions } from './agents-md.types.js';
import { agentsDirs, agentsScope, formatAgentsInstructions } from './agents-md.utils.js';
import { readConfinedFile, realPathOrSelf } from '../instruction-context/confined-read.helper.js';
import { INSTRUCTION_ORDER } from '../instruction-context/instruction-source.constants.js';
import { usableWorkingRoot } from '../working-root/usable-working-root.helper.js';

/**
 * Finds the AGENTS.md files that apply at `cwd`: one per folder from `root` down to `cwd`,
 * root first. Missing files are skipped, and so is one that resolves outside `root` or to a
 * `.env*` file (the folder is the agent's choice, so a link must not lead a secret or a foreign
 * file into its context; see `readConfinedFile`). Paths are relative to `root`.
 */
export async function findAgentsFiles(params: {
  root: string;
  cwd: string;
  signal?: AbortSignal;
}): Promise<AgentsFile[]> {
  const { root, cwd, signal } = params;
  const files: AgentsFile[] = [];
  const boundary = await realPathOrSelf(root);

  for (const dir of agentsDirs({ root, cwd })) {
    const file = path.join(dir, AGENTS_FILE);
    const content = await readConfinedFile({ file, boundary, signal });

    if (content !== undefined) files.push({ path: path.relative(root, file), content });
  }

  return files;
}

/**
 * The AGENTS.md instruction source: each turn, the files from the project root down to the
 * working directory, which is the conversation's working root when one is set.
 */
export function agentsMdSource(options: AgentsMdHookOptions): InstructionSource {
  const { root, cwd = root, workingRoots } = options;

  return {
    name: 'agents-md',
    order: INSTRUCTION_ORDER.agentsMd,
    ...(workingRoots && { workingRoots: usableWorkingRoot(workingRoots) }),
    resolve: async ({ signal, workingRoot }) => {
      // The working root is a real path, so the project root and cwd are compared as real paths:
      // a root reached through a symlink must not make its own cwd look outside it.
      const scope = agentsScope({
        root: await realPathOrSelf(root),
        cwd: await realPathOrSelf(cwd),
        workingRoot,
      });

      return formatAgentsInstructions({ files: await findAgentsFiles({ ...scope, signal }) });
    },
  };
}
