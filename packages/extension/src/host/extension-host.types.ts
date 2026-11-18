import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type {
  EventContribution,
  ExtensionEmitSink,
  NoticeContribution,
  RecordedEmit,
} from '../emit/emit.types.js';
import type { ExtensionActivationError } from '../errors/extension.errors.js';
import type {
  Contributions,
  Extension,
  HostService,
  SettingValue,
  WorkKindContribution,
} from '../extension/extension.types.js';

/** What an extension host needs: the extensions, and what the app supplies to them. */
export type ExtensionHostOptions = {
  extensions: readonly Extension[];
  /**
   * Run-level services the app supplies (`hostService`): every extension can read them without a
   * dependency, and `host.service` reads them too. An extension cannot provide the same key.
   */
  services?: readonly HostService[] | undefined;
  /**
   * The user's setting values by setting name. Checked at construction: a name no extension
   * declares, or a value of another type than the declared default's, throws.
   */
  settings?: Readonly<Record<string, SettingValue>> | undefined;
  /**
   * Whether the user trusts the code of a `project` extension. Without it, project extensions are
   * skipped. Builtin extensions never ask.
   */
  isTrusted?: ((extension: Extension) => boolean | Promise<boolean>) | undefined;
  /**
   * Where the host sends what an extension emits, once checked: the app routes an event to its
   * session's stream and a notice to the session's model. Not a service, so an extension that
   * only holds the emit capability cannot reach it and emit under another's name. An extension
   * with the `sessions` run service can still `publish` or `queueNotice` itself, bypassing the
   * declaration and naming any extension in the envelope; only narrower services close that.
   * The session an emit names can be any session of the run. Without a sink, an emit throws.
   */
  emit?: ExtensionEmitSink | undefined;
};

/**
 * Every extension's contributions, merged in activation order. Hooks are then placed by their
 * `before`/`after` constraints.
 */
export type MergedContributions = {
  tools: readonly Tool[];
  hooks: readonly Hook[];
  workKinds: readonly WorkKindContribution[];
  events: readonly EventContribution[];
  notices: readonly NoticeContribution[];
};

/** A setting an activated extension declared, with the value in effect. */
export type SettingInfo = {
  extension: string;
  name: string;
  description: string;
  default: SettingValue;
  /** The user's value if the host was given one, otherwise the default. */
  value: SettingValue;
};

/**
 * A hook as the host recorded it at the check: the name read once, the hook, and its own frozen
 * copy of the placement. Merging and ordering use `name`, never `hook.name`.
 */
export type RecordedHook = {
  name: string;
  hook: Hook;
  before: readonly string[] | undefined;
  after: readonly string[] | undefined;
};

/** One contribution as the host checked it: the name read once, and the item that carried it. */
export type CheckedEntry<TItem> = {
  name: string;
  /** What the extension returned, to see later that it is still there. */
  original: unknown;
  /** What the host merges: the original, or for a placed hook a copy with its own constraints. */
  item: TItem;
};

/**
 * What an `activate` returned, taken when the host checked it against the manifest: frozen lists
 * of checked entries, and the objects they were read from, so a change after the check shows.
 */
export type ContributionSnapshot = {
  returned: Contributions;
  sources: {
    tools: Contributions['tools'];
    hooks: Contributions['hooks'];
    workKinds: Contributions['workKinds'];
    events: Contributions['events'];
    notices: Contributions['notices'];
  };
  tools: readonly CheckedEntry<Tool>[];
  hooks: readonly CheckedEntry<RecordedHook>[];
  workKinds: readonly CheckedEntry<WorkKindContribution>[];
  events: readonly CheckedEntry<EventContribution>[];
  notices: readonly CheckedEntry<NoticeContribution>[];
  /**
   * What the emitter is armed from: each event kind and notice topic by its recorded name, with
   * the version read once and validated. Never re-read from the live objects.
   */
  emittable: { events: readonly RecordedEmit[]; notices: readonly RecordedEmit[] };
};

/** One extension's checked contributions, with whose they are. */
export type ContributedBy = { extension: string; snapshot: ContributionSnapshot };

/** An extension that did not activate, and why, so a UI can say so. */
export type SkippedExtension =
  | {
      extension: string;
      /** `untrusted`: its code is not trusted. `dependency`: an extension it depends on did not activate. */
      reason: 'untrusted' | 'dependency';
    }
  | {
      extension: string;
      /** `service`: a service its manifest requires is neither supplied by the host nor provided by a dependency. */
      reason: 'service';
      /** The required services nobody offered it, for a message that says what to add. */
      missing: readonly string[];
    };

/** What activating the extensions produced. One extension failing never stops the others. */
export type ActivationResult = {
  contributions: MergedContributions;
  /** The extensions that activated, in activation order. */
  active: readonly string[];
  /** The settings of the extensions that activated, with the value in effect. */
  settings: readonly SettingInfo[];
  /**
   * Those whose `activate` threw, or that used or contributed what their manifest does not declare
   * (the `cause` is then an `ExtensionUndeclaredError`).
   */
  failed: readonly ExtensionActivationError[];
  skipped: readonly SkippedExtension[];
  /**
   * Errors from the `deactivate` of an extension the host stopped without `deactivate()` knowing
   * it: one that finished activating after `deactivate()` had closed the host, or one whose
   * contributions its manifest does not declare. When the host was closed meanwhile, `active` and
   * `contributions` are empty too.
   */
  lateDeactivationErrors: readonly unknown[];
};
