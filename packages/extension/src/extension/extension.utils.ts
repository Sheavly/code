import type { Hook } from '@sheavly/core/hook/hook.types';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { ExtensionDefinitionError } from '../errors/extension.errors.js';
import type { ExtensionManifest, SettingType } from '../manifest/manifest.types.js';
import { deepFreeze } from './deep-freeze.utils.js';
import { UNNAMED_EXTENSION } from './extension.constants.js';
import { extensionManifestSchema } from '../manifest/manifest.validator.js';
import type {
  Extension,
  ExtensionDefinition,
  HostService,
  PlacedHook,
  ServiceConsumer,
  ServiceKey,
  SettingKey,
  SettingTypes,
} from './extension.types.js';

/** The name an unvalidated manifest gives itself, or a placeholder, for the message about it. */
function writtenNameOf(manifest: unknown): string {
  if (typeof manifest !== 'object' || manifest === null) return UNNAMED_EXTENSION;

  const written = 'name' in manifest ? manifest.name : undefined;

  return typeof written === 'string' ? written : UNNAMED_EXTENSION;
}

/**
 * A validated, deep-frozen copy of `input`: nothing the caller keeps a reference to can change it
 * later. Throws an `ExtensionDefinitionError` for anything the schema rejects, including a value
 * that is no object at all.
 */
function frozenManifestOf(input: unknown): ExtensionManifest {
  return deepFreeze(
    parseOrThrow({
      schema: extensionManifestSchema,
      input,
      onInvalid: ({ details, error }) =>
        new ExtensionDefinitionError({
          extension: writtenNameOf(input),
          problem: `its manifest is invalid:\n${details}`,
          cause: error,
        }),
    }),
  );
}

/** The extension that `manifest` and the code describe; the name, dependencies and settings are the manifest's. */
function extensionFrom(params: {
  manifest: ExtensionManifest;
  code: Pick<ExtensionDefinition, 'origin' | 'activate' | 'deactivate'>;
}): Extension {
  const { manifest, code } = params;

  return {
    manifest,
    name: manifest.name,
    dependsOn: manifest.dependsOn,
    settings: deepFreeze(
      manifest.settings.map(({ name, description, default: value }) => ({
        name,
        description,
        default: value,
      })),
    ),
    origin: code.origin,
    activate: code.activate,
    deactivate: code.deactivate,
  };
}

/**
 * Makes an extension from its manifest and its code. The name, `dependsOn` and settings come from
 * the manifest alone. The manifest is checked again here, so one built in memory is held to the
 * same rules as a `sheavly.json`: it throws an `ExtensionDefinitionError` for a bad name, a
 * dependency on itself, a repeated name, a manifest that is no object or any other shape the
 * schema rejects, at startup. The extension holds a deep-frozen copy: changing the object passed
 * in afterwards changes nothing.
 */
export function defineExtension(definition: ExtensionDefinition): Extension {
  return extensionFrom({ manifest: frozenManifestOf(definition.manifest), code: definition });
}

/**
 * The extension as the host holds it: `manifest` read once and validated into a deep-frozen copy,
 * with the name, dependencies and settings derived from that copy alone, whatever a hand-built
 * extension says in those fields. The code is read once too. Throws an `ExtensionDefinitionError`
 * for a manifest the schema rejects.
 */
export function sealExtension(extension: Extension): Extension {
  return extensionFrom({
    manifest: frozenManifestOf(extension.manifest),
    code: {
      origin: extension.origin,
      activate: extension.activate.bind(extension),
      deactivate: extension.deactivate?.bind(extension),
    },
  });
}

/** A typed key for a service: `const FILE_LOCKS = defineService<FileLocks>('file-locks')`. */
export function defineService<TService>(name: string): ServiceKey<TService> {
  return { name };
}

/**
 * A service the app supplies to the run (`ExtensionHostOptions.services`), readable by every
 * extension without a dependency: `hostService({ key: INSTRUCTIONS, value: view })`, where `view`
 * is the frozen `{ text }` view of the system prompt (a `SystemPromptView`), not a string.
 */
export function hostService<TService>(params: {
  key: ServiceKey<TService>;
  value: TService;
}): HostService {
  return { name: params.key.name, value: params.value };
}

/**
 * A service built per extension, so each gets a value limited to what its manifest grants:
 * `hostServiceFor({ key, grants: ['task:read'], create })`. The host calls `create` lazily, once
 * per extension that reads the key and has declared it, with the extension's name and its sealed
 * manifest; `create` returns the value and, optionally, a `disarm` the host calls when it stops
 * that extension. `grants` is what the host accepts in a manifest's `grants` for this service.
 * `create` returns `undefined` when the run has no such service to give: it then reads as not
 * provided, and the grants stay known.
 */
export function hostServiceFor<TService>(params: {
  key: ServiceKey<TService>;
  grants: readonly string[];
  create: (extension: ServiceConsumer) => { value: TService; disarm?: () => void } | undefined;
}): HostService {
  return { name: params.key.name, grants: params.grants, forExtension: params.create };
}

/**
 * A typed key for a setting the manifest declares:
 * `settingKey({ manifest, name: 'notes.max-lines', type: 'number' })` is a `SettingKey<number>`
 * whose default and description are the manifest's. `type` is the runtime tag that gives the key
 * its TypeScript type, checked against the declared one. Throws an `ExtensionDefinitionError`
 * when the manifest does not declare `name` or declares it as another type.
 */
export function settingKey<TType extends SettingType>(params: {
  manifest: ExtensionManifest;
  name: string;
  type: TType;
}): SettingKey<SettingTypes[TType]> {
  const { manifest, name, type } = params;
  const declared = manifest.settings.find((setting) => setting.name === name);

  if (declared === undefined) {
    throw new ExtensionDefinitionError({
      extension: manifest.name,
      problem: `its sheavly.json does not declare the setting "${name}"`,
    });
  }

  if (declared.type !== type) {
    throw new ExtensionDefinitionError({
      extension: manifest.name,
      problem: `its sheavly.json declares the setting "${name}" as a ${declared.type}, not a ${type}`,
    });
  }

  // The schema made the default the type `declared.type` names, which is `type`.
  return {
    name,
    description: declared.description,
    default: declared.default as SettingTypes[TType],
  };
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
