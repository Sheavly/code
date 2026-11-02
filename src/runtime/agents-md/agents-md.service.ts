import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { AGENTS_FILE, MAX_AGENTS_CHARS } from './agents-md.constants.js';
import type { AgentsFile, AgentsMdHookOptions } from './agents-md.types.js';
import { agentsDirs, formatAgentsInstructions } from './agents-md.utils.js';

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
 * root down to the working directory and adds them as system instructions. Read fresh each turn,
 * so edits (including the agent's own) apply on the next model call, and history stays clean.
 */
export function createAgentsMdHook(options: AgentsMdHookOptions): Hook {
  const { root, cwd = root, maxChars = MAX_AGENTS_CHARS } = options;

  return defineHook({
    name: 'agents-md',
    beforeTurn: async ({ signal, addInstructions }) => {
      const files = await findAgentsFiles({ root, cwd, signal });
      const instructions = formatAgentsInstructions({ files, maxChars });

      if (instructions) addInstructions(instructions);
    },
  });
}
