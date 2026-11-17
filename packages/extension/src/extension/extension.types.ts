import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Tool } from '@sheavly/core/tool/tool.types';

/** What an extension can contribute or provide, as named in collision messages. */
export type ContributionKind = 'tool' | 'hook' | 'work kind' | 'setting' | 'service';

/**
 * Where an extension's code comes from. `builtin` ships with the harness; `project` is code from
 * the user's repo, which runs only once the workspace is trusted. It is a declaration by whoever
 * loads the extension, not something the host can verify: the app that embeds an extension
 * vouches for its code, and only the code it loads from a repo is declared `project`.
 */
export type ExtensionOrigin = 'builtin' | 'project';

/**
 * A typed name for a service one extension provides and others read. The type parameter is only
 * for the compiler: it never exists at runtime.
 */
export type ServiceKey<TService> = {
  readonly name: string;
  readonly phantom?: TService | undefined;
};

/** A service the host (the app) supplies to the run: readable by every extension, with no dependency. */
export type HostService = { name: string; value: unknown };

/**
 * The service registry as one extension sees it: it adds its own services and reads what it
 * depends on, plus every service the host supplies.
 */
export type Services = {
  /**
   * Makes `value` available under `key` to the extensions that depend on this one. Throws when
   * another extension, or the host, already provides `key`, naming both.
   */
  provide: <TService>(key: ServiceKey<TService>, value: TService) => void;
  /**
   * The service under `key`. Throws when it is not provided, or provided by an extension this one
   * does not depend on (declare it in `dependsOn`, so activation order guarantees it exists). A
   * service the host supplies is always readable.
   */
  get: <TService>(key: ServiceKey<TService>) => TService;
  /**
   * Like `get`, but `undefined` when nobody provides `key`. For a service of an extension this one
   * does not depend on it returns `undefined` until that extension has activated and throws
   * afterwards, so its answer is order-dependent: `dependsOn` what you `find`.
   */
  find: <TService>(key: ServiceKey<TService>) => TService | undefined;
};

/** A kind of background work an extension adds: its name and whether it ends by itself. */
export type WorkKindContribution = {
  /** Unique across all extensions, `<extension>.<kind>` by convention. */
  name: string;
  description: string;
  /** `finite` ends and can be awaited; `service` runs until stopped. */
  completion: 'finite' | 'service';
};

/** The values a setting can have. */
export type SettingValue = string | number | boolean;

/**
 * A typed, static declaration of a setting, made with `defineSetting`. The type parameter is the
 * type of its value, taken from the default.
 */
export type SettingKey<TValue extends SettingValue> = {
  /** Unique across all extensions, `<extension>.<setting>`. */
  readonly name: string;
  readonly description: string;
  /** The value when the user sets none; its type is the type the user's value must have. */
  readonly default: TValue;
};

/** The settings an extension declared, as it reads them. */
export type Settings = {
  /**
   * The user's value for `key` when the host was given one, otherwise its default. Throws an
   * `ExtensionSettingError` for a key this extension did not declare in `settings`.
   */
  get: <TValue extends SettingValue>(key: SettingKey<TValue>) => TValue;
};

/**
 * A hook with where it goes among the run's hooks. `before` and `after` name other hooks by
 * `hook.name`; a name that is not in the run is ignored.
 */
export type PlacedHook = {
  hook: Hook;
  before?: readonly string[] | undefined;
  after?: readonly string[] | undefined;
};

/** A hook as an extension contributes it: bare (activation order) or placed (`placeHook`). */
export type HookContribution = Hook | PlacedHook;

/**
 * What an extension adds to a run. Contributions add to the loop and never own it: nothing here
 * replaces a core module. Instruction sources contribute as hooks (`createInstructionHook`).
 */
export type Contributions = {
  tools?: readonly Tool[] | undefined;
  hooks?: readonly HookContribution[] | undefined;
  workKinds?: readonly WorkKindContribution[] | undefined;
};

/** What `activate` receives. */
export type ExtensionContext = {
  /** The extension's own name, for messages. */
  extension: string;
  services: Services;
  /** The values of the settings this extension declared. */
  settings: Settings;
  /** Aborted when the session ends while the extension is still activating. */
  signal: AbortSignal;
};

/**
 * One unit of what a run includes. The framework puts no category or policy on it: what an
 * extension can and cannot do is its own to define. The host activates extensions in dependency
 * order, merges their contributions and fails on two with the same name. `activate` runs once per
 * session; `deactivate` runs once when the session ends, in reverse order.
 */
export type Extension = {
  /** Unique, kebab-case. Others name it in `dependsOn`. */
  name: string;
  /**
   * The settings it reads, declared statically with `defineSetting` so the host can validate the
   * user's values before anything activates.
   */
  settings?: readonly SettingKey<SettingValue>[] | undefined;
  /** Default `builtin`. A `project` extension is skipped unless the workspace is trusted. */
  origin?: ExtensionOrigin | undefined;
  /** Extensions that must activate first, by name. Their services become readable. */
  dependsOn?: readonly string[] | undefined;
  activate: (context: ExtensionContext) => Contributions | Promise<Contributions>;
  deactivate?: (() => void | Promise<void>) | undefined;
};
