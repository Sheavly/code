import { ExtensionSettingError } from '../errors/extension.errors.js';
import type {
  Extension,
  SettingKey,
  SettingValue,
  Settings,
} from '../extension/extension.types.js';
import type { SettingInfo } from './extension-host.types.js';

/** The user's values by setting name. */
type SettingValues = Readonly<Record<string, SettingValue>>;

/** The user's value for a setting if there is one (own keys only), otherwise its default. */
function valueOf(params: {
  setting: SettingKey<SettingValue>;
  values: SettingValues;
}): SettingValue {
  const { setting, values } = params;

  return Object.hasOwn(values, setting.name)
    ? (values[setting.name] ?? setting.default)
    : setting.default;
}

/**
 * Every declared setting with its owner. A name is `<extension>.<setting>` and the extension
 * names are unique (the graph is checked first), so no two extensions can declare one.
 */
function declaredSettings(
  extensions: readonly Extension[],
): Map<string, { extension: string; setting: SettingKey<SettingValue> }> {
  const declared = new Map<string, { extension: string; setting: SettingKey<SettingValue> }>();

  for (const extension of extensions) {
    for (const setting of extension.settings) {
      declared.set(setting.name, { extension: extension.name, setting });
    }
  }

  return declared;
}

/**
 * Checks the user's settings against what the extensions declared in their manifests, before
 * anything activates: a value whose name no extension declares (a typo) or whose type differs
 * from the default's throws an `ExtensionSettingError`.
 */
export function assertSettings(params: {
  extensions: readonly Extension[];
  values: SettingValues;
}): void {
  const declared = declaredSettings(params.extensions);

  for (const [name, value] of Object.entries(params.values)) {
    const entry = declared.get(name);

    if (entry === undefined) {
      throw new ExtensionSettingError({
        setting: name,
        problem: 'no extension declares it: check the name for a typo, or add its extension',
      });
    }

    if (typeof value !== typeof entry.setting.default) {
      throw new ExtensionSettingError({
        setting: name,
        problem: `${entry.extension} declares it as a ${typeof entry.setting.default}, but the value is a ${typeof value}`,
      });
    }
  }
}

/**
 * The settings `extension` declared, as it reads them; any other key throws. Only the key's name
 * is used: the default and the type are the manifest's, so a key built by hand with another
 * default (or another extension's name) reads nothing it should not.
 */
export function settingsFor(params: { extension: Extension; values: SettingValues }): Settings {
  const { extension, values } = params;
  const declared = new Map(extension.settings.map((setting) => [setting.name, setting]));

  return {
    get: <TValue extends SettingValue>(key: SettingKey<TValue>): TValue => {
      const setting = declared.get(key.name);

      if (setting === undefined) {
        throw new ExtensionSettingError({
          setting: key.name,
          extension: extension.name,
          problem: 'the extension did not declare it in `settings` of its sheavly.json',
        });
      }

      // `assertSettings` made the user's value the type of the declared default, which `TValue` is.
      return valueOf({ setting, values }) as TValue;
    },
  };
}

/** What each of these extensions declared, with the value in effect, for a UI to list. */
export function settingInfos(params: {
  extensions: readonly Extension[];
  values: SettingValues;
}): SettingInfo[] {
  return params.extensions.flatMap((extension) =>
    extension.settings.map((setting) => ({
      extension: extension.name,
      name: setting.name,
      description: setting.description,
      default: setting.default,
      value: valueOf({ setting, values: params.values }),
    })),
  );
}
