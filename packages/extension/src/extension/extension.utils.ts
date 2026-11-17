import type { Hook } from '@sheavly/core/hook/hook.types';
import { ExtensionDefinitionError } from '../errors/extension.errors.js';
import { EXTENSION_NAME_PATTERN, SETTING_NAME_PATTERN } from './extension.constants.js';
import type {
  Extension,
  HostService,
  PlacedHook,
  ServiceKey,
  SettingKey,
  SettingValue,
} from './extension.types.js';

/**
 * Identity helper for writing an extension; rejects a name that is not kebab-case, a dependency
 * on itself and the same dependency twice. Thrown when it is defined, so it fails at startup.
 */
export function defineExtension(extension: Extension): Extension {
  const { name, dependsOn = [] } = extension;

  if (!EXTENSION_NAME_PATTERN.test(name)) {
    throw new ExtensionDefinitionError({
      extension: name,
      problem: 'the name must be lowercase words joined by hyphens',
    });
  }

  if (dependsOn.includes(name)) {
    throw new ExtensionDefinitionError({ extension: name, problem: 'it cannot depend on itself' });
  }

  if (new Set(dependsOn).size !== dependsOn.length) {
    throw new ExtensionDefinitionError({
      extension: name,
      problem: 'dependsOn names the same extension twice',
    });
  }

  return extension;
}

/** A typed key for a service: `const FILE_LOCKS = defineService<FileLocks>('file-locks')`. */
export function defineService<TService>(name: string): ServiceKey<TService> {
  return { name };
}

/**
 * A service the app supplies to the run (`ExtensionHostOptions.services`), readable by every
 * extension without a dependency: `hostService({ key: SESSIONS, value: sessions })`.
 */
export function hostService<TService>(params: {
  key: ServiceKey<TService>;
  value: TService;
}): HostService {
  return { name: params.key.name, value: params.value };
}

/**
 * A typed setting declaration for `Extension.settings`:
 * `defineSetting({ name: 'notes.max-lines', description: '…', default: 50 })`. Throws an
 * `ExtensionDefinitionError` unless the name is `<extension>.<setting>`, each part lowercase
 * words joined by hyphens.
 */
export function defineSetting<TValue extends SettingValue>(params: {
  name: string;
  description: string;
  default: TValue;
}): SettingKey<TValue> {
  const { name, description } = params;

  if (!SETTING_NAME_PATTERN.test(name)) {
    throw new ExtensionDefinitionError({
      extension: name,
      problem: 'a setting name must be <extension>.<setting>, lowercase words joined by hyphens',
    });
  }

  return { name, description, default: params.default };
}

/**
 * A hook with where it goes among the run's hooks: `before` and `after` name other hooks by
 * `hook.name`. A name that is not in the run is ignored.
 */
export function placeHook(params: {
  hook: Hook;
  before?: readonly string[];
  after?: readonly string[];
}): PlacedHook {
  return { hook: params.hook, before: params.before, after: params.after };
}
