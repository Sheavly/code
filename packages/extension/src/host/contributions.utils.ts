import type { Hook } from '@sheavly/core/hook/hook.types';
import { ContributionCollisionError } from '../errors/extension.errors.js';
import type {
  ContributionKind,
  Contributions,
  HookContribution,
} from '../extension/extension.types.js';
import type { ContributedBy, MergedContributions } from './extension-host.types.js';
import { hookOf, orderHooks } from './hook-order.utils.js';

/**
 * Keeps each name's owner, and throws a `ContributionCollisionError` naming both extensions when a
 * second one brings the same name. Contributions of one kind never shadow each other.
 */
function mergeNamed<TItem extends { name: string }>(params: {
  contribution: ContributionKind;
  lists: readonly { extension: string; items: readonly TItem[] }[];
}): TItem[] {
  const { contribution, lists } = params;
  const owners = new Map<string, string>();
  const merged: TItem[] = [];

  for (const { extension, items } of lists) {
    for (const item of items) {
      const first = owners.get(item.name);

      if (first !== undefined) {
        throw new ContributionCollisionError({
          contribution,
          contributionName: item.name,
          first,
          second: extension,
        });
      }

      owners.set(item.name, extension);
      merged.push(item);
    }
  }

  return merged;
}

/**
 * The hooks of every extension, in activation order and then placed by their `before`/`after`
 * (see `orderHooks`). Two hooks with one name collide first, naming both extensions.
 */
function mergeHooks(
  lists: readonly { extension: string; items: readonly HookContribution[] }[],
): Hook[] {
  const named = mergeNamed({
    contribution: 'hook',
    lists: lists.map(({ extension, items }) => ({
      extension,
      items: items.map((contribution) => ({ name: hookOf(contribution).name, contribution })),
    })),
  });

  return orderHooks(named.map(({ contribution }) => contribution));
}

/**
 * Every extension's contributions as one list per kind, in the order given (activation order);
 * hooks are then placed by their constraints. Two contributions of one kind with the same name
 * throw, naming both extensions; hooks placed in a cycle throw a `HookOrderError`.
 */
export function mergeContributions(contributed: readonly ContributedBy[]): MergedContributions {
  const listsOf = <TItem>(pick: (contributions: Contributions) => readonly TItem[] | undefined) =>
    contributed.map(({ extension, contributions }) => ({
      extension,
      items: pick(contributions) ?? [],
    }));

  return {
    tools: mergeNamed({ contribution: 'tool', lists: listsOf((c) => c.tools) }),
    hooks: mergeHooks(listsOf((c) => c.hooks)),
    workKinds: mergeNamed({ contribution: 'work kind', lists: listsOf((c) => c.workKinds) }),
  };
}
