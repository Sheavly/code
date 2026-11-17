import { ContributionCollisionError, ExtensionSettingError } from '../errors/extension.errors.js';
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

/** Every declared setting with its owner, in extension order; throws when two share a name. */
function declaredSettings(
  extensions: readonly Extension[],
): Map<string, { extension: string; setting: SettingKey<SettingValue> }> {
  const declared = new Map<string, { extension: string; setting: SettingKey<SettingValue> }>();

  for (const extension of extensions) {
    for (const setting of extension.settings ?? []) {
      const first = declared.get(setting.name);

      if (first !== undefined) {
        throw new ContributionCollisionError({
          contribution: 'setting',
          contributionName: setting.name,
          first: first.extension,
          second: extension.name,
        });
      }

      declared.set(setting.name, { extension: extension.name, setting });
    }
  }

  return declared;
}

/**
 * Checks the user's settings against what the extensions declared, before anything activates:
 * two extensions declaring one name throw a `ContributionCollisionError`; a value whose name no
 * extension declares (a typo) or whose type differs from the default's throws an
 * `ExtensionSettingError`.
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

/** The settings `extension` declared, as it reads them; any other key throws. */
export function settingsFor(params: { extension: Extension; values: SettingValues }): Settings {
  const { extension, values } = params;
  const declared = new Set((extension.settings ?? []).map((setting) => setting.name));

  return {
    get: <TValue extends SettingValue>(key: SettingKey<TValue>): TValue => {
      if (!declared.has(key.name)) {
        throw new ExtensionSettingError({
          setting: key.name,
          extension: extension.name,
          problem: 'the extension did not declare it in `settings`',
        });
      }

      // `assertSettings` made the user's value the type of the default, which `TValue` is.
      return valueOf({ setting: key, values }) as TValue;
    },
  };
}

/** What each of these extensions declared, with the value in effect, for a UI to list. */
export function settingInfos(params: {
  extensions: readonly Extension[];
  values: SettingValues;
}): SettingInfo[] {
  return params.extensions.flatMap((extension) =>
    (extension.settings ?? []).map((setting) => ({
      extension: extension.name,
      name: setting.name,
      description: setting.description,
      default: setting.default,
      value: valueOf({ setting, values: params.values }),
    })),
  );
}
