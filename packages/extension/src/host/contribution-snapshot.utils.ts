import type { Tool } from '@sheavly/core/tool/tool.types';
import { ExtensionContributionChangedError } from '../errors/extension.errors.js';
import type {
  ContributionKind,
  Contributions,
  HookContribution,
  UndeclaredUse,
  WorkKindContribution,
} from '../extension/extension.types.js';
import type { ExtensionManifest } from '../manifest/manifest.types.js';
import { assertDeclared } from './declaration.utils.js';
import type {
  CheckedEntry,
  ContributedBy,
  ContributionSnapshot,
  RecordedHook,
} from './extension-host.types.js';
import { hookOf, isPlaced } from './hook-order.utils.js';

/** A tool or work kind is checked as it is. */
function checkedAsIs<TItem extends { name: string }>(item: TItem) {
  return { name: item.name, item };
}

/** A frozen copy of a placed hook's constraint list, so a later change to the original shows nowhere. */
function frozenCopy(list: readonly string[] | undefined): readonly string[] | undefined {
  return list === undefined ? undefined : Object.freeze([...list]);
}

/**
 * A hook as the host will merge it: its name (read once), the hook and its own frozen copy of
 * `before` and `after`. Merging and ordering use the recorded name only.
 */
function checkedHook(contribution: HookContribution): {
  name: string;
  item: RecordedHook;
} {
  const hook = hookOf(contribution);
  const name = hook.name;
  const placed = isPlaced(contribution) ? contribution : undefined;

  return {
    name,
    item: Object.freeze({
      name,
      hook,
      before: frozenCopy(placed?.before),
      after: frozenCopy(placed?.after),
    }),
  };
}

/** One list of what was returned, each name read once and held to the manifest, as frozen entries. */
function checkedList<TContribution, TItem>(params: {
  extension: string;
  use: UndeclaredUse;
  allowed: readonly string[];
  declareIn: string;
  source: readonly TContribution[] | undefined;
  read: (contribution: TContribution) => { name: string; item: TItem };
}): readonly CheckedEntry<TItem>[] {
  const { source, read, ...declared } = params;
  const entries = [...(source ?? [])].map((original) => {
    const { name, item } = read(original);

    assertDeclared({ ...declared, name });

    return { name, original, item };
  });

  return Object.freeze(entries);
}

/**
 * Holds what an `activate` returned to its manifest and keeps what it checked: every tool, hook
 * (a placed hook by its inner hook's name) and work kind must be listed, its name read exactly
 * once. Listing more than it contributes is fine, since some are contributed only under options.
 * Throws an `ExtensionUndeclaredError` for the first not listed. The host merges and orders by the
 * names recorded in the returned snapshot, after `assertSnapshotUnchanged` in the same
 * synchronous step, so a list or name changed later is never merged unchecked. The item objects
 * themselves are not frozen.
 */
export function snapshotContributions(params: {
  manifest: ExtensionManifest;
  contributions: Contributions;
}): ContributionSnapshot {
  const { manifest, contributions } = params;
  const extension = manifest.name;
  const sources = {
    tools: contributions.tools,
    hooks: contributions.hooks,
    workKinds: contributions.workKinds,
  };

  return {
    returned: contributions,
    sources,
    tools: checkedList<Tool, Tool>({
      extension,
      use: 'tool',
      allowed: manifest.tools,
      declareIn: 'tools',
      source: sources.tools,
      read: checkedAsIs,
    }),
    hooks: checkedList({
      extension,
      use: 'hook',
      allowed: manifest.hooks,
      declareIn: 'hooks',
      source: sources.hooks,
      read: checkedHook,
    }),
    workKinds: checkedList<WorkKindContribution, WorkKindContribution>({
      extension,
      use: 'work kind',
      allowed: manifest.workKinds,
      declareIn: 'workKinds',
      source: sources.workKinds,
      read: checkedAsIs,
    }),
  };
}

/** Throws the `ExtensionContributionChangedError` for `problem`. */
function changed(params: {
  extension: string;
  contribution: ContributionKind;
  problem: string;
}): never {
  throw new ExtensionContributionChangedError(params);
}

/** One list still as checked: same list, same length, same entries, each name still the same. */
function assertListUnchanged<TItem>(params: {
  extension: string;
  contribution: ContributionKind;
  source: readonly unknown[] | undefined;
  current: readonly unknown[] | undefined;
  entries: readonly CheckedEntry<TItem>[];
  nameOf: (item: TItem) => string;
}): void {
  const { extension, contribution, source, current, entries, nameOf } = params;

  if (current !== source) changed({ extension, contribution, problem: 'the list was replaced' });

  if ((source?.length ?? 0) !== entries.length) {
    changed({
      extension,
      contribution,
      problem: `the list went from ${entries.length} to ${source?.length ?? 0} entries`,
    });
  }

  entries.forEach((entry, index) => {
    if (source?.[index] !== entry.original) {
      changed({
        extension,
        contribution,
        problem: `entry ${index} ("${entry.name}") was replaced`,
      });
    }

    const now = nameOf(entry.item);

    if (now !== entry.name) {
      changed({ extension, contribution, problem: `"${entry.name}" is now named "${now}"` });
    }
  });
}

/**
 * The extensions among `contributed` whose contributions are no longer what was checked, by name,
 * each with the `ExtensionContributionChangedError` that says what changed. Any other error (a
 * getter that throws) is not expected here and propagates.
 */
export function changedExtensions(contributed: readonly ContributedBy[]): Map<string, unknown> {
  const changedOnes = new Map<string, unknown>();

  for (const { extension, snapshot } of contributed) {
    try {
      assertSnapshotUnchanged({ extension, snapshot });
    } catch (caughtError) {
      if (!(caughtError instanceof ExtensionContributionChangedError)) throw caughtError;

      changedOnes.set(extension, caughtError);
    }
  }

  return changedOnes;
}

/**
 * Throws an `ExtensionContributionChangedError` unless what the extension returned is still what
 * `snapshotContributions` checked: the same lists with the same entries, each named as it was.
 * Run it synchronously before merging, since the extension keeps its references.
 */
function assertSnapshotUnchanged(params: {
  extension: string;
  snapshot: ContributionSnapshot;
}): void {
  const { extension, snapshot } = params;
  const { returned, sources } = snapshot;

  assertListUnchanged({
    extension,
    contribution: 'tool',
    source: sources.tools,
    current: returned.tools,
    entries: snapshot.tools,
    nameOf: (tool) => tool.name,
  });
  assertListUnchanged({
    extension,
    contribution: 'hook',
    source: sources.hooks,
    current: returned.hooks,
    entries: snapshot.hooks,
    nameOf: (recorded) => recorded.hook.name,
  });
  assertListUnchanged({
    extension,
    contribution: 'work kind',
    source: sources.workKinds,
    current: returned.workKinds,
    entries: snapshot.workKinds,
    nameOf: (kind) => kind.name,
  });
}
