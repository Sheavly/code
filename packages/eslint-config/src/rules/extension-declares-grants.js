// A scoped run service refuses a call whose grant the extension's `sheavly.json` does not list, but
// only when the call runs: one in a tool's `execute`, a hook handler or a rare branch can stay
// unseen. In the non-test source of `extensions/*` a call to a method of a scoped service is
// reported when the workspace's manifest `grants` lacks the grant that method needs. Which grant
// each method needs is read at lint time from `RUN_SERVICE_GRANTS` and the keys from
// `run-services.utils.ts` in the extension package (`run-service-grants.utils.js`,
// `run-service-types.utils.js`), so a new method or service is covered with no edit here. By
// syntax only (`extension-scope-calls.utils.js`): a scope read with `services.get(KEY)` or
// `services.find(KEY)`, or a parameter or variable annotated with a scope type from the contract.
// A call of `{ grant, arguments }` also needs the grant of an argument property written as a
// property of an object literal first argument. The mapping is checked first: it is reported
// once per linted file when the file exists and parses but is not the documented plain literal,
// even for an extension with no manifest; a missing file or a syntax error stays silent (the
// compiler reports it). Then, for calls: a missing or unreadable manifest or a missing keys file
// makes the rule report no call (the layout check and the other rules report those). A declared
// grant no call needs is not reported: one file cannot see the whole workspace.
import { readSheavlyJson } from '../extension-manifest.utils.js';
import { readExtensionContract } from '../extension-contract.utils.js';
import { LAYOUT_RULE_OPTIONS } from '../layout.utils.js';
import {
  readRunServiceGrants,
  RUN_SERVICE_GRANTS_FILE,
  staticKey,
} from '../run-service-grants.utils.js';
import { readRunServices } from '../run-service-types.utils.js';
import { scopeResolver } from './extension-scope-calls.utils.js';
import { extensionWorkspaceOf } from './extension-source.utils.js';

const MANIFEST_FILE = 'sheavly.json';

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The grants the workspace's manifest lists, or undefined when it can't be read as a manifest. */
function declaredGrants(workspace) {
  const found = readSheavlyJson(workspace.dir);

  if (!found.exists || found.error !== undefined || !isRecord(found.data)) return undefined;

  const { grants } = found.data;

  if (grants === undefined) return new Set();

  return Array.isArray(grants) ? new Set(grants) : undefined;
}

/**
 * What `call` of a member with `entry` needs, as `grant -> the argument property that asks for it`
 * (undefined for the base grant). Argument grants are read only from an object literal first
 * argument without a spread: any other argument is review-only.
 */
function neededGrants(params) {
  const { entry, call } = params;
  const needed = new Map([[entry.grant, undefined]]);
  const [first] = call.arguments;

  if (first?.type !== 'ObjectExpression') return needed;

  if (first.properties.some((property) => property.type === 'SpreadElement')) return needed;

  for (const property of first.properties) {
    const name = staticKey(property);
    const grant = name === undefined ? undefined : entry.arguments.get(name);
    const isUndefined =
      property.value?.type === 'Identifier' && property.value.name === 'undefined';

    if (grant !== undefined && !isUndefined && !needed.has(grant)) needed.set(grant, name);
  }

  return needed;
}

/** The entry of the first of `services` that has `method`, with that service's name. */
function entryFor(params) {
  const { grants, services, method } = params;

  for (const service of services) {
    const entry = grants.get(service)?.get(method);

    if (entry) return { service, entry };
  }

  return undefined;
}

export const extensionDeclaresGrants = {
  meta: {
    type: 'problem',
    schema: [LAYOUT_RULE_OPTIONS],
    messages: {
      missing:
        'The call `{{call}}` needs the grant `{{grant}}`, which {{manifest}} does not list: add "{{grant}}" to its "grants", or drop the call. A call without its declared grant is refused when it runs.',
      unreadable:
        "This rule could not read the grants of the scoped run services from `{{file}}`: it exists but `RUN_SERVICE_GRANTS` is not a plain literal of the documented shape (`{ 'service': { member: 'grant' | { grant: 'grant', arguments: { property: 'grant' } } } } as const`, with no spread, computed key, call or imported value) or is missing. Restore that form, or update `harness/extension-declares-grants`, so calls stay checked against the manifest.",
    },
  },
  create(context) {
    const found = extensionWorkspaceOf(context);

    if (!found) return {};

    const { root, workspace } = found;
    const { state, grants } = readRunServiceGrants(root);

    // A mapping that parses but yields nothing means this rule has gone blind: say so once per
    // file, before the manifest is looked at. A missing file or a syntax error stays silent: the
    // compiler and the layout check report those.
    if (state === 'read' && grants.size === 0) {
      return {
        Program(node) {
          context.report({
            node,
            messageId: 'unreadable',
            data: { file: RUN_SERVICE_GRANTS_FILE },
          });
        },
      };
    }

    const { keys } = readRunServices(root);

    // Nothing to follow without the mapping and the keys: a throwaway tree, a checkout without them.
    if (grants.size === 0 || keys.size === 0) return {};

    const resolver = scopeResolver({ context, keys, contract: readExtensionContract(root) });
    const manifest = `${workspace.relative}/${MANIFEST_FILE}`;
    let declared;

    return {
      CallExpression(node) {
        const { callee } = node;

        if (callee.type !== 'MemberExpression' || callee.computed) return;

        if (callee.property.type !== 'Identifier') return;

        const method = callee.property.name;
        const target = entryFor({ grants, method, services: resolver.serviceOf(callee.object) });

        if (!target) return;

        declared ??= declaredGrants(workspace) ?? null;

        if (declared === null) return;

        for (const [grant, argument] of neededGrants({ entry: target.entry, call: node })) {
          if (declared.has(grant)) continue;

          const name = `${target.service}.${method}`;

          context.report({
            node,
            messageId: 'missing',
            data: { call: argument ? `${name}({ ${argument} })` : name, grant, manifest },
          });
        }
      },
    };
  },
};
