import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { InstructionSourceError } from '../errors/instruction-source.errors.js';
import { WorkspaceError } from '../errors/workspace.errors.js';
import { appendInstructionContext } from './instruction-context.helper.js';
import type {
  InstructionHook,
  InstructionSource,
  WorkingRootSource,
} from './instruction-source.types.js';

/**
 * The working root for this turn. A root that went bad is `undefined` here: the file tools tell
 * the agent so, and an instruction source falls back to the workspace root.
 */
async function currentWorkingRoot(
  workingRoots: WorkingRootSource | undefined,
): Promise<string | undefined> {
  try {
    return await workingRoots?.root();
  } catch (caughtError) {
    if (caughtError instanceof WorkspaceError) return undefined;

    throw caughtError;
  }
}

/**
 * The one way to build an instruction-context hook. Each turn it resolves the working root, asks
 * the source what applies and appends it with `appendInstructionContext`. What it already sent is
 * read from the history the hook is given, so a summary or masking that drops the entry makes the
 * next turn announce it again; the hook keeps no state, so sub-agents running it announce on
 * their own history.
 */
export function createInstructionHook(source: InstructionSource): InstructionHook {
  const { name, order, workingRoots, resolve } = source;
  const hook = defineHook({
    name,
    beforeTurn: async (context) => {
      const workingRoot = await currentWorkingRoot(workingRoots);
      const instructions = await resolve({ signal: context.signal, workingRoot });

      appendInstructionContext({ context, name, instructions });
    },
  });

  return { hook, order };
}

/**
 * The hooks in the order their sources declared, not the order they were passed in (equal
 * orders keep it). Two with the same name are a collision and throw.
 */
export function registerInstructionHooks(entries: readonly InstructionHook[]): Hook[] {
  const names = new Set<string>();

  for (const { hook } of entries) {
    if (names.has(hook.name)) throw new InstructionSourceError({ source: hook.name });
    names.add(hook.name);
  }

  return entries.toSorted((a, b) => a.order - b.order).map(({ hook }) => hook);
}
