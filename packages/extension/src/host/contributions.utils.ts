import type { Hook } from '@sheavly/core/hook/hook.types';
import { ContributionCollisionError } from '../errors/extension.errors.js';
import type { ContributionKind } from '../extension/extension.types.js';
import type {
  CheckedEntry,
  ContributedBy,
  ContributionSnapshot,
  MergedContributions,
  RecordedHook,
} from './extension-host.types.js';
import { orderHooks } from './hook-order.utils.js';

/**
 * Keeps each name's owner, and throws a `ContributionCollisionError` naming both extensions when a
 * second one brings the same name. Contributions of one kind never shadow each other.
 */
function mergeNamed<TItem>(params: {
  contribution: ContributionKind;
  lists: readonly { extension: string; entries: readonly CheckedEntry<TItem>[] }[];
}): CheckedEntry<TItem>[] {
  const { contribution, lists } = params;
  const owners = new Map<string, string>();
  const merged: CheckedEntry<TItem>[] = [];

  for (const { extension, entries } of lists) {
    for (const entry of entries) {
      const first = owners.get(entry.name);

      if (first !== undefined) {
        throw new ContributionCollisionError({
          contribution,
          contributionName: entry.name,
          first,
          second: extension,
        });
      }

      owners.set(entry.name, extension);
      merged.push(entry);
    }
  }

  return merged;
}

/**
 * The hooks of every extension, in activation order and then placed by their `before`/`after`
 * (see `orderHooks`). Two hooks with one name collide first, naming both extensions.
 */
function mergeHooks(
  lists: readonly { extension: string; entries: readonly CheckedEntry<RecordedHook>[] }[],
): Hook[] {
  const named = mergeNamed({ contribution: 'hook', lists });

  return orderHooks(named.map(({ item }) => item));
}

/**
 * Every extension's checked contributions (see `snapshotContributions`) as one list per kind, in
 * the order given (activation order); hooks are then placed by their constraints. Names are the
 * ones recorded at the check. Two contributions of one kind with the same name throw, naming
 * both extensions; hooks placed in a cycle throw a `HookOrderError`.
 */
export function mergeContributions(contributed: readonly ContributedBy[]): MergedContributions {
  const listsOf = <TItem>(
    pick: (snapshot: ContributionSnapshot) => readonly CheckedEntry<TItem>[],
  ) => contributed.map(({ extension, snapshot }) => ({ extension, entries: pick(snapshot) }));

  return {
    tools: mergeNamed({ contribution: 'tool', lists: listsOf((s) => s.tools) }).map(
      ({ item }) => item,
    ),
    hooks: mergeHooks(listsOf((s) => s.hooks)),
    workKinds: mergeNamed({ contribution: 'work kind', lists: listsOf((s) => s.workKinds) }).map(
      ({ item }) => item,
    ),
    events: mergeNamed({ contribution: 'event', lists: listsOf((s) => s.events) }).map(
      ({ item }) => item,
    ),
    notices: mergeNamed({ contribution: 'notice', lists: listsOf((s) => s.notices) }).map(
      ({ item }) => item,
    ),
  };
}
