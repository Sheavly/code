import type { Tool } from '@sheavly/core/tool/tool.types';
import { isInNamespace } from '@sheavly/protocol/extension/extension.utils';
import { extensionQualifiedNameSchema } from '@sheavly/protocol/extension/extension.validator';
import type { EventContribution, NoticeContribution, RecordedEmit } from '../emit/emit.types.js';
import { ExtensionEmitError } from '../errors/emit.errors.js';
import { ExtensionContributionChangedError } from '../errors/extension.errors.js';
import type {
  ContributionKind,
  Contributions,
  HookContribution,
  InstructionContribution,
  UndeclaredUse,
  WorkKindContribution,
} from '../extension/extension.types.js';
import type { ExtensionManifest } from '../manifest/manifest.types.js';
import { assertDeclared, declaredNoticeTopics } from './declaration.utils.js';
import type {
  CheckedEntry,
  ContributedBy,
  ContributionSnapshot,
  RecordedHook,
} from './extension-host.types.js';
import { hookOf, isPlaced } from './hook-order.utils.js';
import {
  assertMayExtendPrompt,
  checkedBaseInstructions,
  checkedInstruction,
} from './instruction-check.utils.js';

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

/** Throws the `ExtensionEmitError` for a contribution whose name or version is not valid. */
function invalidContribution(params: { extension: string; name: string; problem: string }): never {
  throw new ExtensionEmitError({
    ...params,
    emitted: params.name,
    failure: 'invalid-contribution',
  });
}

/**
 * What the emitter is armed from: each checked entry's recorded name, with its version and schema
 * read once, frozen. The name must be a qualified name in the extension's namespace and the
 * version a positive integer, as the protocol will read them; otherwise the contribution (and so
 * the activation) fails, naming the extension. The schema is held by reference.
 */
function recordedEmits(params: {
  extension: string;
  entries: readonly CheckedEntry<EventContribution | NoticeContribution>[];
}): readonly RecordedEmit[] {
  const { extension, entries } = params;
  const recorded = entries.map(({ name, item }) => {
    const { version, schema } = item;

    if (
      !extensionQualifiedNameSchema.safeParse(name).success ||
      !isInNamespace({ extension, name })
    ) {
      invalidContribution({ extension, name, problem: 'its name must be "<extension>.<name>"' });
    }

    if (!Number.isInteger(version) || version < 1) {
      invalidContribution({ extension, name, problem: 'its version must be a positive integer' });
    }

    return Object.freeze({ name, version, schema });
  });

  return Object.freeze(recorded);
}

/**
 * Holds what an `activate` returned to its manifest and keeps what it checked: every tool, hook
 * (a placed hook by its inner hook's name), instruction section and work kind must be listed, its
 * name read exactly once, and every contribution field of `contributions` is read once here (the
 * instruction list is copied once, and that copy decides the grant, the checks and the merge).
 * Instruction sections also need the `system-prompt:extend` grant and a
 * valid text (`ExtensionInstructionError`), and are held as frozen `{ name, text }` copies. Listing more than it contributes is fine, since some are contributed only under options.
 * Throws an `ExtensionUndeclaredError` for the first not listed. The host merges and orders by the
 * names recorded in the returned snapshot, after `assertSnapshotUnchanged` in the same
 * synchronous step, so a list or name changed later is never merged unchecked. The item objects
 * themselves are not frozen. An event or notice is also recorded for the emitter by its recorded
 * name, with its version read once (`recordedEmits`); an invalid name or version throws too.
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
    instructions: contributions.instructions,
    workKinds: contributions.workKinds,
    events: contributions.events,
    notices: contributions.notices,
  };

  // One copy of the one read: the grant, the section checks and the merge all use it, so a getter
  // or proxy that answers differently the second time decides nothing.
  const sections = [...(sources.instructions ?? [])];

  assertMayExtendPrompt({ manifest, sections });

  const events = checkedList({
    extension,
    use: 'event',
    allowed: manifest.emits.events,
    declareIn: 'emits.events',
    source: sources.events,
    read: (event: EventContribution) => ({ name: event.kind, item: event }),
  });
  const notices = checkedList({
    extension,
    use: 'notice',
    allowed: declaredNoticeTopics(manifest),
    declareIn: 'emits.modelFacingNotices (set it to true)',
    source: sources.notices,
    read: (notice: NoticeContribution) => ({ name: notice.topic, item: notice }),
  });

  return {
    returned: contributions,
    sources,
    events,
    notices,
    emittable: {
      events: recordedEmits({ extension, entries: events }),
      notices: recordedEmits({ extension, entries: notices }),
    },
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
    instructions: checkedList({
      extension,
      use: 'instruction',
      allowed: manifest.instructions,
      declareIn: 'instructions',
      source: sections,
      read: (section: InstructionContribution) => checkedInstruction({ extension, section }),
    }),
    baseInstructions: checkedBaseInstructions({ manifest, contributions }),
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
    contribution: 'instruction',
    source: sources.instructions,
    current: returned.instructions,
    entries: snapshot.instructions,
    nameOf: (section) => section.name,
  });
  assertListUnchanged({
    extension,
    contribution: 'work kind',
    source: sources.workKinds,
    current: returned.workKinds,
    entries: snapshot.workKinds,
    nameOf: (kind) => kind.name,
  });
  assertListUnchanged({
    extension,
    contribution: 'event',
    source: sources.events,
    current: returned.events,
    entries: snapshot.events,
    nameOf: (event) => event.kind,
  });
  assertListUnchanged({
    extension,
    contribution: 'notice',
    source: sources.notices,
    current: returned.notices,
    entries: snapshot.notices,
    nameOf: (notice) => notice.topic,
  });
}
