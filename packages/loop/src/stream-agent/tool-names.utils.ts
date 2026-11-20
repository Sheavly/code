import type { Tool } from '@sheavly/core/tool/tool.types';
import { DuplicateToolError } from '../errors/loop.errors.js';

/**
 * The list a run goes on with: a copy of `tools`, frozen, after `assertUniqueToolNames` passed it.
 * Whoever holds the original array can still change it, but not what the run sends the model or
 * runs: the check holds for the whole run. The tool objects themselves are not frozen.
 */
export function freezeUniqueTools(tools: readonly Tool[]): Tool[] {
  const copy = Object.freeze([...tools]);

  assertUniqueToolNames(copy);

  // Frozen at runtime; typed as the mutable list `runTool` takes, which only reads it.
  return copy as Tool[];
}

/**
 * Throws `DuplicateToolError` for the first name two tools of the run share. Names are compared
 * exactly: they are the identifiers the model calls, so `Read` and `read` are two tools. Hooks
 * have their own check (`orderContributions`), which reports a different error.
 */
function assertUniqueToolNames(tools: readonly Pick<Tool, 'name'>[]): void {
  const counts = new Map<string, number>();

  for (const { name } of tools) counts.set(name, (counts.get(name) ?? 0) + 1);

  for (const [tool, count] of counts) {
    if (count > 1) throw new DuplicateToolError({ tool, count });
  }
}
