import { InstructionSourceError } from '../errors/instruction-source.errors.js';
import type { Hook } from '../hook/hook.types.js';
import { defineHook } from '../hook/hook.utils.js';
import { appendInstructionContext } from './instruction-context.helper.js';
import type { InstructionHook, InstructionSource } from './instruction-source.types.js';

/**
 * The one way to build an instruction-context hook. Each turn it reads the source's working root,
 * asks the source what applies and appends it with `appendInstructionContext`. What it already
 * sent is read from the history the hook is given, so a summary or masking that drops the entry
 * makes the next turn announce it again; the hook keeps no state, so sub-agents running it
 * announce on their own history. A throw from `workingRoots.root()` fails the turn: the source's
 * owner decides what an unusable folder means.
 */
export function createInstructionHook(source: InstructionSource): InstructionHook {
  const { name, order, workingRoots, resolve } = source;
  const hook = defineHook({
    name,
    beforeTurn: async (context) => {
      const workingRoot = await workingRoots?.root();
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
