import type { Hook } from '@sheavly/core/hook/hook.types';
import { HookOrderError } from '../errors/extension.errors.js';
import type { HookContribution, PlacedHook } from '../extension/extension.types.js';
import type { RecordedHook } from './extension-host.types.js';

/** A bare hook has no `hook` field; a placed one wraps its hook in `hook`. */
export function isPlaced(contribution: HookContribution): contribution is PlacedHook {
  return 'hook' in contribution;
}

/** The hook of a contribution, bare or placed. */
export function hookOf(contribution: HookContribution): Hook {
  return isPlaced(contribution) ? contribution.hook : contribution;
}

/** For each hook name, the names that must run before it, among the hooks in the run. */
function predecessorsOf(recorded: readonly RecordedHook[]): Map<string, Set<string>> {
  const present = new Set(recorded.map(({ name }) => name));
  const predecessors = new Map<string, Set<string>>();

  for (const name of present) predecessors.set(name, new Set());

  for (const { name, before, after } of recorded) {
    for (const other of after ?? []) {
      if (present.has(other)) predecessors.get(name)?.add(other);
    }

    for (const other of before ?? []) {
      if (present.has(other)) predecessors.get(other)?.add(name);
    }
  }

  return predecessors;
}

/** The hooks left once no one more can be placed: a cycle, or what waits behind one. */
function stuckNames(params: { names: readonly string[]; placed: ReadonlySet<string> }): string[] {
  return params.names.filter((name) => !params.placed.has(name));
}

/**
 * How early each hook is needed: its own position, or the earliest position of a hook it is
 * placed `before`. So a hook placed before another goes to where the hook it names originally was
 * (its activation position), instead of pushing the hooks in between aside; if that hook is
 * itself placed `after` something, it ends up later than that position and the placed hook does
 * not follow it. A hook placed `after` another just waits for it, and the hook it names stays
 * where it was. A cycle is not followed twice; it is reported when the hooks
 * are ordered.
 */
function urgencies(params: {
  names: readonly string[];
  recorded: readonly RecordedHook[];
}): Map<string, number> {
  const { names, recorded } = params;
  const successors = new Map<string, readonly string[]>();

  for (const { name, before } of recorded) {
    successors.set(
      name,
      (before ?? []).filter((other) => names.includes(other)),
    );
  }

  const urgency = new Map<string, number>();
  const visiting = new Set<string>();
  const earliestOf = (name: string): number => {
    const known = urgency.get(name);

    if (known !== undefined) return known;
    if (visiting.has(name)) return Number.POSITIVE_INFINITY;

    visiting.add(name);

    const earliest = Math.min(
      names.indexOf(name),
      ...(successors.get(name) ?? []).map((next) => earliestOf(next)),
    );

    visiting.delete(name);
    urgency.set(name, earliest);

    return earliest;
  };

  for (const name of names) earliestOf(name);

  return urgency;
}

/**
 * Puts hooks in their final order: activation order, changed only as far as the `before`/`after`
 * constraints need. It is a topological sort that takes, among the hooks free to go, the one
 * needed earliest (see `urgencies`), so only a placed hook moves, to just before or after what it
 * names. Only the recorded names are used, never `hook.name`. A constraint naming a hook that is not in the run is ignored. Throws `HookOrderError`
 * for a hook placed against itself or a cycle.
 */
export function orderHooks(recorded: readonly RecordedHook[]): Hook[] {
  const names = recorded.map(({ name }) => name);
  const predecessors = predecessorsOf(recorded);
  const urgency = urgencies({ names, recorded });

  for (const [name, before] of predecessors) {
    if (before.has(name)) {
      throw new HookOrderError({
        hooks: [name],
        problem: `Hook "${name}" is placed before or after itself.`,
      });
    }
  }

  const placed = new Set<string>();
  const ordered: Hook[] = [];

  while (ordered.length < recorded.length) {
    const free = names.filter(
      (name) =>
        !placed.has(name) && [...(predecessors.get(name) ?? [])].every((one) => placed.has(one)),
    );
    const [first] = free.toSorted(
      (a, b) =>
        (urgency.get(a) ?? 0) - (urgency.get(b) ?? 0) || names.indexOf(a) - names.indexOf(b),
    );
    const next = first === undefined ? undefined : recorded[names.indexOf(first)];

    if (next === undefined) {
      const stuck = stuckNames({ names, placed });

      throw new HookOrderError({
        hooks: stuck,
        problem: `Hooks are placed in a cycle (or behind one): ${stuck.join(', ')}. Remove one before/after.`,
      });
    }

    placed.add(next.name);
    ordered.push(next.hook);
  }

  return ordered;
}
