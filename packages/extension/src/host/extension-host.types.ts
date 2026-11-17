import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
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
};

/**
 * Every extension's contributions, merged in activation order. Hooks are then placed by their
 * `before`/`after` constraints.
 */
export type MergedContributions = {
  tools: readonly Tool[];
  hooks: readonly Hook[];
  workKinds: readonly WorkKindContribution[];
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

/** One extension's contributions, with whose they are. */
export type ContributedBy = { extension: string; contributions: Contributions };

/** An extension that did not activate, and why, so a UI can say so. */
export type SkippedExtension = {
  extension: string;
  /** `untrusted`: its code is not trusted. `dependency`: an extension it depends on did not activate. */
  reason: 'untrusted' | 'dependency';
};

/** What activating the extensions produced. One extension failing never stops the others. */
export type ActivationResult = {
  contributions: MergedContributions;
  /** The extensions that activated, in activation order. */
  active: readonly string[];
  /** The settings of the extensions that activated, with the value in effect. */
  settings: readonly SettingInfo[];
  /** Those whose `activate` threw. */
  failed: readonly ExtensionActivationError[];
  skipped: readonly SkippedExtension[];
  /**
   * Errors from the `deactivate` of an extension that finished activating after `deactivate()` had
   * closed the host: `deactivate()` never knew it, so its errors come back here. When the host was
   * closed meanwhile, `active` and `contributions` are empty too.
   */
  lateDeactivationErrors: readonly unknown[];
};
