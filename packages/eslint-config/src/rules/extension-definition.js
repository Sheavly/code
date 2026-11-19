// An extension builds itself with `defineExtension({ manifest, activate })`, where `manifest` is
// `readManifest(new URL('../../sheavly.json', import.meta.url))`: its workspace's own
// `sheavly.json`, which is the one place that says its `name`, `dependsOn` and settings. The call
// must not repeat them (they would drift), and must read this workspace's file, not another's
// or one at the wrong depth. The file itself (it exists, parses, names the folder, lists the
// extensions in `dependencies`, ships) is the layout check's (`extension-manifest.utils.js`).
// The manifest is the call written in place or a module-level `const` initialised with it. An
// extension built by a helper rather than a direct object literal can't be followed: review covers
// it. `readManifest` must be the import from '@sheavly/extension/manifest/manifest.helper' (under
// any local name); a local function of that name is reported.
import path from 'node:path';
import {
  LAYOUT_RULE_OPTIONS,
  listWorkspaces,
  readLayout,
  workspaceOfFile,
} from '../layout.utils.js';
import { isTestOrFake } from '../test-paths.utils.js';
import { findVariable } from './extension-source.utils.js';
import { findRoot } from './workspace-types.js';

/** What the manifest provides, so the call must not say it again. */
const DERIVED = ['name', 'dependsOn', 'settings'];
const MANIFEST_FILE = 'sheavly.json';
const READ_MANIFEST_MODULE = '@sheavly/extension/manifest/manifest.helper';
const isString = (node) => node?.type === 'Literal' && typeof node.value === 'string';
const toPosix = (file) => file.split(path.sep).join('/');

function propertyNamed(params) {
  const { object, name } = params;

  return object.properties.find(
    (property) =>
      property.type === 'Property' &&
      !property.computed &&
      (property.key.name === name || property.key.value === name),
  );
}

function isImportMetaUrl(node) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.property.name === 'url' &&
    node.object.type === 'MetaProperty' &&
    node.object.meta.name === 'import' &&
    node.object.property.name === 'meta'
  );
}

/**
 * Whether the callee of `call` is the `readManifest` imported from the manifest helper, under
 * whatever local name: a local function of that name, or an import of something else, is not it.
 */
function callsImportedReadManifest(params) {
  const { context, call } = params;

  if (call.callee.type !== 'Identifier') return false;

  const variable = findVariable({
    scope: context.sourceCode.getScope(call),
    name: call.callee.name,
  });
  const [definition] = variable?.defs ?? [];

  return (
    variable?.defs.length === 1 &&
    definition.type === 'ImportBinding' &&
    definition.node.type === 'ImportSpecifier' &&
    definition.node.imported.name === 'readManifest' &&
    definition.parent.source.value === READ_MANIFEST_MODULE
  );
}

/** The path of `readManifest(new URL('<path>', import.meta.url))`; undefined for any other shape. */
function readManifestPath(params) {
  const { context, call } = params;

  if (call?.type !== 'CallExpression') return undefined;

  if (!callsImportedReadManifest({ context, call })) return undefined;

  const [url] = call.arguments;

  if (call.arguments.length !== 1 || url?.type !== 'NewExpression') return undefined;

  if (url.callee.name !== 'URL' || url.arguments.length !== 2) return undefined;

  const [target, base] = url.arguments;

  return isString(target) && isImportMetaUrl(base) ? target.value : undefined;
}

/**
 * The expression a `manifest` value stands for: itself, or the initialiser of the one `const` it
 * names. Undefined for a parameter, an import, a `let` or anything reassignable.
 */
function manifestExpression(params) {
  const { context, node, value } = params;

  if (value.type !== 'Identifier') return value;

  const variable = findVariable({ scope: context.sourceCode.getScope(node), name: value.name });
  const [definition] = variable?.defs ?? [];

  if (variable?.defs.length !== 1 || definition.type !== 'Variable') return undefined;

  return definition.parent.kind === 'const' ? definition.node.init : undefined;
}

/** The path that reaches the workspace's `sheavly.json` from the file, as `new URL` writes it. */
function expectedPath(params) {
  const { workspace, file } = params;
  const relative = toPosix(
    path.relative(path.dirname(file), path.join(workspace.dir, MANIFEST_FILE)),
  );

  return relative.startsWith('.') ? relative : `./${relative}`;
}

function checkManifest(params) {
  const { context, node, object, workspace, root } = params;
  const found = propertyNamed({ object, name: 'manifest' });
  const expected = expectedPath({ workspace, file: context.filename });

  if (!found) {
    context.report({ node, messageId: 'noManifest', data: { expected } });

    return;
  }

  const expression = manifestExpression({ context, node, value: found.value });
  const written = readManifestPath({ context, call: expression });

  if (written === undefined) {
    context.report({ node: found.value, messageId: 'notReadManifest', data: { expected } });

    return;
  }

  const target = path.resolve(path.dirname(context.filename), written);

  if (target !== path.join(workspace.dir, MANIFEST_FILE)) {
    context.report({
      node: expression,
      messageId: 'wrongManifest',
      data: { actual: written, found: toPosix(path.relative(root, target)), expected },
    });
  }
}

function checkNotRepeated(params) {
  const { context, object } = params;

  for (const property of DERIVED) {
    const found = propertyNamed({ object, name: property });

    if (found) context.report({ node: found, messageId: 'repeated', data: { property } });
  }
}

export const extensionDefinition = {
  meta: {
    type: 'problem',
    schema: [LAYOUT_RULE_OPTIONS],
    messages: {
      notObject:
        'defineExtension must be called with an object literal without a spread, so its manifest can be checked. Write `defineExtension({ manifest, activate })` in place.',
      repeated:
        "`{{property}}` comes from the manifest (sheavly.json): remove it from the call, so it can't drift from the file.",
      noManifest:
        "defineExtension must be given the workspace's manifest: add `manifest: readManifest(new URL('{{expected}}', import.meta.url))`.",
      notReadManifest:
        "`manifest` must be `readManifest(new URL('{{expected}}', import.meta.url))`, written in the call or in a module-level `const`: `readManifest` imported from '@sheavly/extension/manifest/manifest.helper', a string-literal path and `import.meta.url`, so it can be checked against this workspace. An object literal or another reader isn't accepted in an extension's source.",
      wrongManifest:
        "manifest reads '{{actual}}', which is {{found}}, not this workspace's sheavly.json: use '{{expected}}'.",
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

        if (layout[workspace.name]?.kind !== 'extension') return;

        const object = node.arguments[0];

        if (
          object?.type !== 'ObjectExpression' ||
          object.properties.some(({ type }) => type === 'SpreadElement')
        ) {
          context.report({ node, messageId: 'notObject' });

          return;
        }

        checkNotRepeated({ context, object });
        checkManifest({ context, node, object, workspace, root });
      },
    };
  },
};
