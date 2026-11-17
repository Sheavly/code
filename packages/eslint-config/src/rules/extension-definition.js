// An extension's `defineExtension({ name, dependsOn, activate })` says again what its workspace
// already says: the folder and the dependencies on other extension workspaces. Read from the
// layout on disk, so the declaration can't drift from the workspace: a `dependsOn` that omits a
// real dependency leaves activation order to luck. An extension has no domain or category. A
// value that isn't a literal can't be checked and is reported.
import path from 'node:path';
import {
  LAYOUT_RULE_OPTIONS,
  listWorkspaces,
  readLayout,
  workspaceOfFile,
} from '../layout.utils.js';
import { isTestOrFake } from '../test-paths.utils.js';
import { findRoot } from './workspace-types.js';

const folderOf = (entry) => path.posix.basename(entry.dir);
const isString = (node) => node.type === 'Literal' && typeof node.value === 'string';

/** What the workspace says the declaration must be. */
function expectedOf(params) {
  const { entry, layout } = params;

  return {
    folder: folderOf(entry),
    dependencies: entry.dependsOn
      .filter((dependency) => layout[dependency]?.kind === 'extension')
      .map((dependency) => ({ package: dependency, folder: folderOf(layout[dependency]) })),
  };
}

function propertyNamed(params) {
  const { object, name } = params;

  return object.properties.find(
    (property) =>
      property.type === 'Property' &&
      !property.computed &&
      (property.key.name === name || property.key.value === name),
  );
}

function reportNotLiteral(params) {
  const { context, node, property, shape } = params;

  context.report({ node, messageId: 'notLiteral', data: { property, shape } });
}

function checkString(params) {
  const { context, object, property, expected } = params;
  const found = propertyNamed({ object, name: property });

  if (!found || !isString(found.value)) {
    reportNotLiteral({
      context,
      node: found?.value ?? object,
      property,
      shape: 'string literal',
    });

    return;
  }

  if (found.value.value !== expected) {
    context.report({
      node: found.value,
      messageId: property,
      data: { actual: found.value.value, expected: String(expected) },
    });
  }
}

/** The names `dependsOn` lists, or null after reporting that they can't be read as literals. */
function listedNames(params) {
  const { context, object } = params;
  const found = propertyNamed({ object, name: 'dependsOn' });
  const shape = 'array literal of string literals';

  if (!found) return { node: object, elements: [] };

  if (found.value.type !== 'ArrayExpression') {
    reportNotLiteral({ context, node: found.value, property: 'dependsOn', shape });

    return null;
  }

  const unreadable = found.value.elements.filter((element) => !element || !isString(element));

  for (const element of unreadable) {
    reportNotLiteral({ context, node: element ?? found.value, property: 'dependsOn', shape });
  }

  return unreadable.length > 0 ? null : { node: found.value, elements: found.value.elements };
}

function checkDependsOn(params) {
  const { context, object, expected } = params;
  const listed = listedNames({ context, object });

  if (!listed) return;

  const folders = new Set(expected.dependencies.map(({ folder }) => folder));
  const seen = new Set();

  for (const element of listed.elements) {
    const name = element.value;

    if (seen.has(name)) {
      context.report({ node: element, messageId: 'duplicate', data: { name } });
    } else if (!folders.has(name)) {
      context.report({ node: element, messageId: 'extra', data: { name } });
    }

    seen.add(name);
  }

  for (const dependency of expected.dependencies.filter(({ folder }) => !seen.has(folder))) {
    context.report({
      node: listed.node,
      messageId: 'missing',
      data: { package: dependency.package, name: dependency.folder },
    });
  }
}

export const extensionDefinition = {
  meta: {
    type: 'problem',
    schema: [LAYOUT_RULE_OPTIONS],
    messages: {
      notObject:
        'defineExtension must be called with an object literal, so its name and dependsOn can be checked against the workspace. Write `defineExtension({ name, dependsOn, activate })` in place.',
      notLiteral:
        '`{{property}}` must be written in the call as a {{shape}}, so it can be checked against the workspace.',
      name: "name must be the workspace folder name: change '{{actual}}' to '{{expected}}'.",
      missing:
        "dependsOn must name every extension this workspace depends on ({{package}}): add '{{name}}'.",
      extra:
        "dependsOn names '{{name}}', which is not an extension in this workspace's package.json `dependencies`: remove it, or add that extension there if it is a real dependency (devDependencies don't count).",
      duplicate: "dependsOn lists '{{name}}' twice: remove the duplicate.",
      noRoot:
        'harness/extension-definition could not find the workspace root (a package.json with `workspaces`) above {{cwd}}. Pass `root`; it fails rather than skip, so no extension goes unchecked.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const root = options.root ?? findRoot(context.cwd);

    return {
      CallExpression: (node) => {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'defineExtension') return;

        if (!root) {
          context.report({ node, messageId: 'noRoot', data: { cwd: context.cwd } });

          return;
        }

        const workspace = workspaceOfFile({
          workspaces: listWorkspaces(root),
          file: context.filename,
        });

        if (!workspace || isTestOrFake(path.relative(workspace.dir, context.filename))) return;

        const layout = options.layout ?? readLayout({ root });
        const entry = layout[workspace.name];

        if (entry?.kind !== 'extension') return;

        const object = node.arguments[0];

        if (object?.type !== 'ObjectExpression') {
          context.report({ node, messageId: 'notObject' });

          return;
        }

        const expected = expectedOf({ entry, layout });

        checkString({ context, object, property: 'name', expected: expected.folder });
        checkDependsOn({ context, object, expected });
      },
    };
  },
};
