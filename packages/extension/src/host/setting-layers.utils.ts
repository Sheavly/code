import { ExtensionSettingError } from '../errors/extension.errors.js';
import type { Extension, SettingValue } from '../extension/extension.types.js';
import type {
  DeclaredSetting,
  IgnoredSetting,
  LayeredSettings,
  SettingLayer,
  SettingLayerName,
  SettingSource,
} from './setting-layers.types.js';
import { declaredSettings, valueProblem } from './settings.utils.js';

type Declared = ReadonlyMap<string, DeclaredSetting>;

/**
 * The values of a layer the user owns (global or profile), each checked against the declarations.
 * A typo or a wrong type throws, naming the layer and its file: the user can fix their own file,
 * so a mistake must be loud.
 */
function checkedUserLayer(params: {
  layerName: SettingLayerName;
  layer: SettingLayer | undefined;
  declared: Declared;
}): Map<string, SettingValue> {
  const { layerName, layer, declared } = params;
  const checked = new Map<string, SettingValue>();

  if (layer === undefined) return checked;

  for (const [name, value] of Object.entries(layer.values)) {
    const found = valueProblem({ declared, name, value });

    if (found !== undefined) {
      throw new ExtensionSettingError({
        setting: name,
        source: `the ${layerName} settings (${layer.source})`,
        problem: found.problem,
      });
    }

    checked.set(name, value);
  }

  return checked;
}

/** Why a workspace may not set `name` to `value`, or `undefined` when it may. */
function workspaceRefusal(params: {
  declared: Declared;
  name: string;
  value: SettingValue;
  workspaceTrusted: boolean;
}): IgnoredSetting['reason'] | undefined {
  const { declared, name, value, workspaceTrusted } = params;
  const found = valueProblem({ declared, name, value });

  if (found !== undefined) return found.reason;

  const setting = declared.get(name)?.setting;

  if (setting?.scope !== 'project') return 'scope';

  return setting.restricted && !workspaceTrusted ? 'restricted' : undefined;
}

/**
 * The workspace's values that apply, and the entries that do not. The file is shared by a team
 * whose installed extensions differ, so an entry that does not apply is reported, never fatal.
 */
function workspaceValues(params: {
  layer: SettingLayer | undefined;
  declared: Declared;
  workspaceTrusted: boolean;
}): { accepted: Map<string, SettingValue>; ignored: IgnoredSetting[] } {
  const { layer, declared, workspaceTrusted } = params;
  const accepted = new Map<string, SettingValue>();
  const ignored: IgnoredSetting[] = [];

  for (const [name, value] of Object.entries(layer?.values ?? {})) {
    const reason = workspaceRefusal({ declared, name, value, workspaceTrusted });

    if (reason === undefined) {
      accepted.set(name, value);
    } else {
      ignored.push(Object.freeze({ name, layer: 'workspace', reason }));
    }
  }

  return { accepted, ignored };
}

/**
 * Decides the value of every declared setting from three layers, strongest first: `global`, then
 * `profile`, then `workspace`, then the manifest's default. Pure: the caller reads and parses the
 * files (`parseSettingsFile`) and decides `workspaceTrusted`.
 *
 * The global and profile layers may set any declared setting; a name no extension declares or a
 * value of another type than the default's throws an `ExtensionSettingError` naming the layer and
 * its file. The workspace layer may only set a `project` setting, and a `restricted` one only when
 * `workspaceTrusted`; every other workspace entry (undeclared, wrong type, `user` scope,
 * restricted while untrusted) is left out and listed in `ignored`, without its value.
 *
 * `values` holds only the settings some layer sets, so it is what `ExtensionHost` takes as
 * `settings`; `sources` names the layer in effect for every declared setting.
 */
export function layerSettings(params: {
  extensions: readonly Extension[];
  global?: SettingLayer | undefined;
  profile?: SettingLayer | undefined;
  workspace?: SettingLayer | undefined;
  workspaceTrusted: boolean;
}): LayeredSettings {
  const declared = declaredSettings(params.extensions);
  const { accepted, ignored } = workspaceValues({
    layer: params.workspace,
    declared,
    workspaceTrusted: params.workspaceTrusted,
  });
  const layers: [SettingLayerName, Map<string, SettingValue>][] = [
    ['global', checkedUserLayer({ layerName: 'global', layer: params.global, declared })],
    ['profile', checkedUserLayer({ layerName: 'profile', layer: params.profile, declared })],
    ['workspace', accepted],
  ];
  const values = new Map<string, SettingValue>();
  const sources = new Map<string, SettingSource>();

  for (const name of declared.keys()) {
    sources.set(name, 'default');

    for (const [layerName, layerValues] of layers) {
      const value = layerValues.get(name);

      if (value !== undefined) {
        values.set(name, value);
        sources.set(name, layerName);
        break;
      }
    }
  }

  return {
    values: Object.freeze(Object.fromEntries(values)),
    sources: Object.freeze(Object.fromEntries(sources)),
    ignored: Object.freeze(ignored),
  };
}
