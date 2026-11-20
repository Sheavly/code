import { ExtensionSettingError } from '../errors/extension.errors.js';
import type {
  Extension,
  SettingKey,
  SettingValue,
  Settings,
} from '../extension/extension.types.js';
import type { SettingInfo } from './extension-host.types.js';
import type { DeclaredSetting, SettingSource, ValueProblem } from './setting-layers.types.js';

/** The user's values by setting name. */
type SettingValues = Readonly<Record<string, SettingValue>>;

/** The layer in effect by setting name; a name that is absent is at its default. */
type SettingSources = Readonly<Record<string, SettingSource>>;

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
export function declaredSettings(extensions: readonly Extension[]): Map<string, DeclaredSetting> {
  const declared = new Map<string, DeclaredSetting>();

  for (const extension of extensions) {
    for (const setting of extension.settings) {
      declared.set(setting.name, { extension: extension.name, setting });
    }
  }

  return declared;
}

/**
 * What is wrong with `value` for the setting `name`, or `undefined` when it is a declared name
 * and the declared default's type. The one wording `assertSettings` and `layerSettings` share;
 * it never repeats the value.
 */
export function valueProblem(params: {
  declared: ReadonlyMap<string, DeclaredSetting>;
  name: string;
  value: SettingValue;
}): ValueProblem | undefined {
  const { declared, name, value } = params;
  const entry = declared.get(name);

  if (entry === undefined) {
    return {
      reason: 'not-declared',
      problem: 'no extension declares it: check the name for a typo, or add its extension',
    };
  }

  if (typeof value !== typeof entry.setting.default) {
    return {
      reason: 'wrong-type',
      problem: `${entry.extension} declares it as a ${typeof entry.setting.default}, but the value is a ${typeof value}`,
    };
  }

  return undefined;
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
    const found = valueProblem({ declared, name, value });

    if (found !== undefined) {
      throw new ExtensionSettingError({ setting: name, problem: found.problem });
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

/**
 * What each of these extensions declared, with the value in effect and the layer it came from
 * (`default` for a name `sources` does not list), for a UI to list.
 */
export function settingInfos(params: {
  extensions: readonly Extension[];
  values: SettingValues;
  sources: SettingSources;
}): SettingInfo[] {
  const { values, sources } = params;

  return params.extensions.flatMap((extension) =>
    extension.settings.map((setting) => ({
      extension: extension.name,
      name: setting.name,
      description: setting.description,
      default: setting.default,
      value: valueOf({ setting, values }),
      source: Object.hasOwn(sources, setting.name)
        ? (sources[setting.name] ?? 'default')
        : 'default',
      scope: setting.scope,
      restricted: setting.restricted,
    })),
  );
}
