import type { SettingKey, SettingValue } from '../extension/extension.types.js';

/** A layer of user-chosen values, strongest first: the user's, then the profile's, then the workspace's. */
export type SettingLayerName = 'global' | 'profile' | 'workspace';

/** Where the value in effect for a setting came from: a layer, or the manifest's default. */
export type SettingSource = SettingLayerName | 'default';

/** One layer's raw values by setting name, as `parseSettingsFile` returns them, and the label of its file. */
export type SettingLayer = {
  /** What names the file in a message: a path or a name. */
  source: string;
  values: Readonly<Record<string, SettingValue>>;
};

/** A setting the extensions declared, with the extension that owns it. */
export type DeclaredSetting = { extension: string; setting: SettingKey<SettingValue> };

/** What is wrong with a value for a setting, and which kind of wrong it is. */
export type ValueProblem = { reason: 'not-declared' | 'wrong-type'; problem: string };

/**
 * A workspace value that did not apply, and why: `not-declared` (no installed extension declares
 * the name), `wrong-type` (not the declared default's type), `scope` (the setting is `user`, not
 * `project`), `restricted` (the setting is restricted and the workspace is not trusted). It never
 * carries the value.
 */
export type IgnoredSetting = {
  name: string;
  layer: 'workspace';
  reason: 'not-declared' | 'wrong-type' | 'scope' | 'restricted';
};

/** What `layerSettings` decided; every part is frozen. */
export type LayeredSettings = {
  /** The value in effect for each setting some layer sets, by name; a setting no layer sets is absent (its default applies). */
  values: Readonly<Record<string, SettingValue>>;
  /** The layer in effect for every declared setting, `default` included. */
  sources: Readonly<Record<string, SettingSource>>;
  /** The workspace entries that did not apply, in the file's order. */
  ignored: readonly IgnoredSetting[];
};
