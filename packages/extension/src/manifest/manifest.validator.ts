import {
  EXTENSION_NAME_PATTERN,
  QUALIFIED_NAME_PATTERN,
} from '@sheavly/protocol/extension/extension.constants';
import { z } from 'zod';
import {
  BASE_INSTRUCTIONS_SECTION,
  HOST_OFFERED_GRANTS,
} from '../instructions/instructions.constants.js';
import {
  CREDENTIAL_WORDS,
  GRANT_PATTERN,
  MAX_LIST_SIZE,
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
} from './manifest.constants.js';

/** One problem found by a check that spans fields: where it is and what is wrong. */
type Problem = { path: (string | number)[]; message: string };

/** What the cross-field checks read: the manifest as the object schema parsed it. */
type Fields = {
  name: string;
  dependsOn: string[];
  services: {
    requires: string[];
    optional: string[];
    provides: string[];
    grants?: Record<string, string[]> | undefined;
  };
  settings: { name: string; scope: 'user' | 'project'; restricted: boolean }[];
  tools: string[];
  hooks: string[];
  instructions: string[];
  workKinds: string[];
  emits: { events: string[] };
  serves: { actions: string[] };
  grants?: string[] | undefined;
};

const kebabName = z
  .string()
  .max(MAX_NAME_LENGTH)
  .regex(EXTENSION_NAME_PATTERN, 'must be lowercase words joined by hyphens');

const qualifiedName = z
  .string()
  .max(MAX_NAME_LENGTH)
  .regex(QUALIFIED_NAME_PATTERN, 'must be <extension>.<name>, lowercase words joined by hyphens');

/** A service name matches by exact name, so it is a kebab name and never a wildcard. */
const serviceName = z
  .string()
  .max(MAX_NAME_LENGTH)
  .refine(
    (name) => !name.includes('*'),
    'a service name cannot contain "*": services match by exact name',
  )
  .regex(EXTENSION_NAME_PATTERN, 'must be lowercase words joined by hyphens');

/** A verb-level capability a host service understands: `<noun>:<verb>`, in lowercase kebab parts. */
const grantName = z
  .string()
  .max(MAX_NAME_LENGTH)
  .regex(GRANT_PATTERN, 'must be <noun>:<verb>, each lowercase words joined by hyphens');

const names = z.array(z.string().min(1).max(MAX_NAME_LENGTH)).max(MAX_LIST_SIZE).default([]);

const extensionNames = z.array(kebabName).max(MAX_LIST_SIZE).default([]);

const serviceNames = z.array(serviceName).max(MAX_LIST_SIZE).default([]);

const settingBase = {
  name: qualifiedName,
  description: z.string().min(1).max(MAX_TEXT_LENGTH),
  /** Who may set it: `user` from the user's own files only, `project` also from a workspace's `.sheavly/settings.json`. */
  scope: z.enum(['user', 'project']).default('user'),
  /** A `project` setting a workspace may set only when the workspace is trusted. */
  restricted: z.boolean().default(false),
};

/** A setting's declaration: its `default` must be of its `type`, so the two are one union. */
const settingSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...settingBase,
    type: z.literal('string'),
    default: z.string().max(MAX_TEXT_LENGTH),
  }),
  z.strictObject({ ...settingBase, type: z.literal('number'), default: z.number() }),
  z.strictObject({ ...settingBase, type: z.literal('boolean'), default: z.boolean() }),
]);

/** The names that appear more than once in `list`, reported at each repeat. */
function repeats(params: { path: string[]; list: readonly string[] }): Problem[] {
  const { path, list } = params;

  return list.flatMap((name, index) =>
    list.indexOf(name) === index
      ? []
      : [{ path: [...path, index], message: `"${name}" is listed twice` }],
  );
}

/** The names outside `<extension>.`, reported at each one. */
function outsideNamespace(params: {
  path: string[];
  list: readonly string[];
  extension: string;
}): Problem[] {
  const { path, list, extension } = params;

  return list.flatMap((name, index) =>
    name.startsWith(`${extension}.`)
      ? []
      : [{ path: [...path, index], message: `"${name}" must start with "${extension}."` }],
  );
}

/**
 * The wildcard entries that are not allowed: a `*` is only valid as the last character, as a
 * prefix wildcard (`project-hooks.*`). A bare `*`, which matches every name, is only for
 * `hooks`, whose names a project's own files may choose.
 */
function wildcardProblems(params: {
  path: string[];
  list: readonly string[];
  allowBare: boolean;
}): Problem[] {
  const { path, list, allowBare } = params;

  return list.flatMap((name, index) => {
    const at = [...path, index];
    const stars = name.split('*').length - 1;

    if (stars === 0) return [];

    if (stars > 1 || !name.endsWith('*')) {
      return [
        { path: at, message: `"${name}": a "*" is only allowed once, as the last character` },
      ];
    }

    if (name === '*' && !allowBare) {
      return [{ path: at, message: 'a bare "*" is only allowed in hooks; give a prefix' }];
    }

    return [];
  });
}

/** Every name containing a `*`: a section matches by exact name, so no wildcard is allowed. */
function exactNameProblems(params: { path: string[]; list: readonly string[] }): Problem[] {
  const { path, list } = params;

  return list.flatMap((name, index) =>
    name.includes('*')
      ? [{ path: [...path, index], message: `"${name}": a name here cannot contain "*"` }]
      : [],
  );
}

/** The reserved replacement-base label, which no section may be named. */
function reservedNameProblems(params: { path: string[]; list: readonly string[] }): Problem[] {
  const { path, list } = params;

  return list.flatMap((name, index) =>
    name === BASE_INSTRUCTIONS_SECTION
      ? [
          {
            path: [...path, index],
            message: `"${name}": a name here cannot be "${BASE_INSTRUCTIONS_SECTION}", which is reserved for a replacement base`,
          },
        ]
      : [],
  );
}

/** Names listed twice, or wildcards written wrongly, in tools, hooks, instructions and work kinds. */
function contributionProblems(fields: Fields): Problem[] {
  return [
    ...exactNameProblems({ path: ['instructions'], list: fields.instructions }),
    ...reservedNameProblems({ path: ['instructions'], list: fields.instructions }),
    ...repeats({ path: ['tools'], list: fields.tools }),
    ...repeats({ path: ['hooks'], list: fields.hooks }),
    ...repeats({ path: ['workKinds'], list: fields.workKinds }),
    ...repeats({ path: ['instructions'], list: fields.instructions }),
    ...wildcardProblems({ path: ['tools'], list: fields.tools, allowBare: false }),
    ...wildcardProblems({ path: ['hooks'], list: fields.hooks, allowBare: true }),
    ...wildcardProblems({ path: ['workKinds'], list: fields.workKinds, allowBare: false }),
  ];
}

/** A dependency on the extension itself, and the same dependency twice. */
function dependencyProblems(fields: Fields): Problem[] {
  const own = fields.dependsOn.flatMap((name, index) =>
    name === fields.name
      ? [{ path: ['dependsOn', index], message: 'an extension cannot depend on itself' }]
      : [],
  );

  return [...own, ...repeats({ path: ['dependsOn'], list: fields.dependsOn })];
}

/** A service listed twice in a list, or both required and optional. */
function serviceProblems(fields: Fields): Problem[] {
  const { requires, optional, provides } = fields.services;
  const both = optional.flatMap((name, index) =>
    requires.includes(name)
      ? [{ path: ['services', 'optional', index], message: `"${name}" is already in requires` }]
      : [],
  );

  return [
    ...repeats({ path: ['services', 'requires'], list: requires }),
    ...repeats({ path: ['services', 'optional'], list: optional }),
    ...repeats({ path: ['services', 'provides'], list: provides }),
    ...both,
  ];
}

/**
 * The grants a provided service declares: only for a service in `provides`, each once, and never
 * one the host offers itself (it needs no service, so a service cannot claim it).
 */
function serviceGrantProblems(fields: Fields): Problem[] {
  const { provides, grants = {} } = fields.services;

  return Object.entries(grants).flatMap(([service, list]) => {
    const path = ['services', 'grants', service];
    const unprovided = provides.includes(service)
      ? []
      : [
          {
            path,
            message: `"${service}" is not in services.provides: only a provided service can declare grants`,
          },
        ];
    const hostOwned = list.flatMap((grant, index) =>
      HOST_OFFERED_GRANTS.includes(grant)
        ? [{ path: [...path, index], message: `"${grant}" is a grant the host offers itself` }]
        : [],
    );

    return [...unprovided, ...repeats({ path, list }), ...hostOwned];
  });
}

/** A setting whose name has a credential word as a whole segment: a setting holds no credential. */
function credentialNameProblems(settings: Fields['settings']): Problem[] {
  return settings.flatMap(({ name }, index) => {
    const segments = name
      .slice(name.indexOf('.') + 1)
      .toLowerCase()
      .split(/[-_.]/);
    const word = segments.find((segment) => CREDENTIAL_WORDS.includes(segment));

    return word === undefined
      ? []
      : [
          {
            path: ['settings', index, 'name'],
            message: `"${name}" looks like a credential ("${word}"): a setting holds no credential, so rename it`,
          },
        ];
  });
}

/** A `restricted` setting is read from a workspace, so it must be `project`: on a `user` one it protects nothing. */
function restrictedProblems(settings: Fields['settings']): Problem[] {
  return settings.flatMap(({ restricted, scope }, index) =>
    restricted && scope === 'user'
      ? [
          {
            path: ['settings', index, 'restricted'],
            message:
              'a restricted setting must have scope "project": a "user" setting is never read from a workspace',
          },
        ]
      : [],
  );
}

/** Settings are named `<extension>.<setting>`, once each, and `restricted` only on a `project` one. */
function settingProblems(fields: Fields): Problem[] {
  const list = fields.settings.map((setting) => setting.name);

  return [
    ...outsideNamespace({ path: ['settings'], list, extension: fields.name }),
    ...repeats({ path: ['settings'], list }),
    ...credentialNameProblems(fields.settings),
    ...restrictedProblems(fields.settings),
  ];
}

/** Events and actions are `<extension>.<kind>` in the extension's own namespace, once each. */
function reservedProblems(fields: Fields): Problem[] {
  const { events } = fields.emits;
  const { actions } = fields.serves;

  return [
    ...outsideNamespace({ path: ['emits', 'events'], list: events, extension: fields.name }),
    ...repeats({ path: ['emits', 'events'], list: events }),
    ...outsideNamespace({ path: ['serves', 'actions'], list: actions, extension: fields.name }),
    ...repeats({ path: ['serves', 'actions'], list: actions }),
  ];
}

/** Every problem the field schemas cannot see, because it relates one field to another. */
function crossFieldProblems(fields: Fields): Problem[] {
  return [
    ...dependencyProblems(fields),
    ...serviceProblems(fields),
    ...serviceGrantProblems(fields),
    ...settingProblems(fields),
    ...contributionProblems(fields),
    ...reservedProblems(fields),
    ...repeats({ path: ['grants'], list: fields.grants ?? [] }),
  ];
}

/**
 * `sheavly.json`: what an extension needs and contributes, as data, so something can read it
 * without running the extension. Unknown keys are rejected, so a typo does not silently declare
 * nothing. Every field but `name` is optional and defaults to empty.
 */
export const extensionManifestSchema = z
  .strictObject({
    /** The JSON Schema the file follows, for editors. */
    $schema: z.string().max(MAX_TEXT_LENGTH).optional(),
    name: kebabName,
    dependsOn: extensionNames,
    services: z
      .strictObject({
        requires: serviceNames,
        optional: serviceNames,
        provides: serviceNames,
        /**
         * The grants each provided service understands, by service name (a key must be in
         * `provides`). A service that declares grants is provided per consumer
         * (`services.provideFor`), so it can enforce them. Absent means none.
         */
        grants: z.record(serviceName, z.array(grantName).max(MAX_LIST_SIZE)).optional(),
      })
      .prefault({}),
    settings: z.array(settingSchema).max(MAX_LIST_SIZE).default([]),
    tools: names,
    hooks: names,
    /**
     * The system-prompt sections it may contribute, by exact name. Needs the `system-prompt:extend`
     * grant; the host refuses an undeclared section.
     */
    instructions: names,
    workKinds: names,
    /**
     * Enforced by the host: an event kind the extension contributes must be listed in `events`,
     * and a notice needs `modelFacingNotices`; `emit` refuses what is not declared.
     */
    emits: z
      .strictObject({
        events: z.array(qualifiedName).max(MAX_LIST_SIZE).default([]),
        modelFacingNotices: z.boolean().default(false),
      })
      .prefault({}),
    /**
     * The verb-level capabilities the extension asks of the host's per-extension services. The
     * host fails the activation of an extension that names a grant no supplied service offers,
     * or one whose service it does not read; each service enforces its own grants. The host
     * offers `system-prompt:extend` and `system-prompt:replace` itself: they need no service.
     */
    grants: z.array(grantName).max(MAX_LIST_SIZE).optional(),
    /** Reserved: validated, not yet enforced by the host. */
    serves: z
      .strictObject({ actions: z.array(qualifiedName).max(MAX_LIST_SIZE).default([]) })
      .prefault({}),
  })
  .check((context) => {
    for (const { path, message } of crossFieldProblems(context.value)) {
      context.issues.push({ code: 'custom', message, path, input: context.value });
    }
  });
