import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { AGENTS_FILE } from './agents-md.constants.js';
import type { AgentsFile, AgentsMdHookOptions } from './agents-md.types.js';
import { agentsDirs, formatAgentsInstructions } from './agents-md.utils.js';
import { appendInstructionContext } from '../instruction-context/instruction-context.helper.js';

/**
 * Finds the AGENTS.md files that apply at `cwd`: one per folder from `root` down to `cwd`,
 * root first. Missing files are skipped; paths are relative to `root`.
 */
export async function findAgentsFiles(params: {
  root: string;
  cwd: string;
  signal?: AbortSignal;
}): Promise<AgentsFile[]> {
  const { root, cwd, signal } = params;
  const files: AgentsFile[] = [];

  for (const dir of agentsDirs({ root, cwd })) {
    const file = path.join(dir, AGENTS_FILE);

    try {
      const content = await readFile(file, { encoding: 'utf8', ...(signal && { signal }) });

      files.push({ path: path.relative(root, file), content });
    } catch (caughtError) {
      const code = (caughtError as NodeJS.ErrnoException).code;

      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw caughtError;
    }
  }

  return files;
}

/**
 * The built-in AGENTS.md hook: before every turn, reads the AGENTS.md files from the project
 * root down to the working directory. Changes are appended to history, so edits apply on the
 * next model call without invalidating earlier signed thinking blocks.
 */
export function createAgentsMdHook(options: AgentsMdHookOptions): Hook {
  const { root, cwd = root } = options;

  return defineHook({
    name: 'agents-md',
    beforeTurn: async (context) => {
      const files = await findAgentsFiles({ root, cwd, signal: context.signal });
      const instructions = formatAgentsInstructions({ files });

      appendInstructionContext({ context, name: 'agents-md', instructions });
    },
  });
}
