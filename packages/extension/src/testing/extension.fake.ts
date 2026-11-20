import { defineHook } from '@sheavly/core/hook/hook.utils';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { z } from 'zod';
import type { Contributions, Extension, SettingValue } from '../extension/extension.types.js';
import { defineExtension } from '../extension/extension.utils.js';
import { hookOf } from '../host/hook-order.utils.js';
import type { ExtensionManifest, SettingManifest } from '../manifest/manifest.types.js';
import type { FakeExtensionFields } from './extension-fake.types.js';

/** A tool with the given name that answers `ok`, for tests that only care that it was contributed. */
export function fakeTool(name: string) {
  return defineTool({
    name,
    description: `Fake tool ${name}`,
    inputSchema: z.object({}),
    execute: async () => 'ok',
  });
}

/** A hook with the given name that handles `sessionStart` and adds nothing. */
export function fakeHook(name: string) {
  return defineHook({ name, sessionStart: async () => undefined });
}

/** An instruction section with the given name; its text is a heading and the name, unless given. */
export function fakeInstruction(params: { name: string; text?: string }) {
  const { name, text = `# Section ${name}` } = params;

  return { name, text };
}

/**
 * A setting declaration for `fakeExtension`, its `type` taken from the default's:
 * `fakeSetting({ name: 'notes.level', default: 3 })`.
 */
export function fakeSetting(params: {
  name: string;
  default: SettingValue;
  description?: string;
  scope?: SettingManifest['scope'];
  restricted?: boolean;
}): SettingManifest {
  const {
    name,
    default: value,
    description = `Fake setting ${name}`,
    scope = 'user',
    restricted = false,
  } = params;
  const base = { name, description, scope, restricted };

  if (typeof value === 'string') return { ...base, type: 'string', default: value };

  if (typeof value === 'number') return { ...base, type: 'number', default: value };

  return { ...base, type: 'boolean', default: value };
}

/** The names a `contributes` holds, one list per kind, to declare them. */
function contributedNames(contributes: Contributions = {}) {
  return {
    tools: (contributes.tools ?? []).map((tool) => tool.name),
    hooks: (contributes.hooks ?? []).map((hook) => hookOf(hook).name),
    instructions: (contributes.instructions ?? []).map((section) => section.name),
    workKinds: (contributes.workKinds ?? []).map((kind) => kind.name),
    events: (contributes.events ?? []).map((event) => event.kind),
    notices: contributes.notices ?? [],
  };
}

/** The in-memory manifest for `fields`: what they declare, in the shape of a parsed `sheavly.json`. */
function fakeManifest(fields: FakeExtensionFields): ExtensionManifest {
  const contributed = contributedNames(fields.contributes);

  return {
    name: fields.name,
    dependsOn: [...(fields.dependsOn ?? [])],
    services: {
      requires: [...(fields.requires ?? [])],
      optional: [...(fields.optional ?? [])],
      provides: [...(fields.provides ?? [])],
      ...(fields.serviceGrants === undefined
        ? {}
        : {
            grants: Object.fromEntries(
              Object.entries(fields.serviceGrants).map(([service, grants]) => [
                service,
                [...grants],
              ]),
            ),
          }),
    },
    settings: [...(fields.settings ?? [])],
    tools: [...new Set([...(fields.tools ?? []), ...contributed.tools])],
    hooks: [...new Set([...(fields.hooks ?? []), ...contributed.hooks])],
    instructions: [...new Set([...(fields.instructions ?? []), ...contributed.instructions])],
    workKinds: [...new Set([...(fields.workKinds ?? []), ...contributed.workKinds])],
    emits: {
      events: [...new Set([...(fields.emits?.events ?? []), ...contributed.events])],
      modelFacingNotices: fields.emits?.modelFacingNotices ?? contributed.notices.length > 0,
    },
    serves: { actions: [] },
    ...(fields.grants === undefined ? {} : { grants: [...fields.grants] }),
  };
}

/**
 * A builtin extension whose manifest declares what `fields` say, and that contributes nothing
 * unless `contributes` or `activate` says so. The host holds it to its manifest like any other.
 */
export function fakeExtension(fields: FakeExtensionFields): Extension {
  const { contributes = {}, origin, activate, deactivate } = fields;

  return defineExtension({
    manifest: fakeManifest(fields),
    origin,
    activate: activate ?? (() => contributes),
    deactivate,
  });
}
