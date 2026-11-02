// Imports follow the workspace layout (`layout.js`). In every workspace, tests included:
//
// - `@sheavly/<x>` only if the importing workspace lists it in `dependsOn` (so never an app, and
//   never a coding package from a generic one); a `testOnly` workspace only from tests and fakes;
// - no relative import that leaves the importing workspace (`../../packages/core/...`): import
//   another workspace by its package name;
// - in the app being split (its `layers`), a relative import into another layer only if this
//   layer lists it; tests and fakes are exempt there, since they wire concrete pieces together.
import path from 'node:path';
import { LAYOUT } from '../layout.js';
import { layerEntry, listWorkspaces, workspaceOfFile } from '../layout.utils.js';
import { findRoot } from './workspace-types.js';

const LAYOUT_FILE = 'packages/eslint-config/src/layout.js';
const TEST_CODE = /(^|\/)(__tests__|testing)\//;

/** The layer a path inside `src/` belongs to: its first folder, or the root file's name. */
function layerOf(relativeToSrc) {
  return relativeToSrc.split('/')[0];
}

function toPosix(file) {
  return file.split(path.sep).join('/');
}

export const importsRule = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { root: { type: 'string' }, layout: { type: 'object' } },
        additionalProperties: false,
      },
    ],
    messages: {
      notInGraph: `{{from}} may not import {{target}}: it isn't in {{from}}'s \`dependsOn\` in ${LAYOUT_FILE}. {{why}}`,
      testOnly: `{{target}} is for tests and fakes only; source never imports it.`,
      crossesWorkspace: `This relative import leaves {{from}} for {{target}}. Import it by package name (\`@sheavly/...\`), along the layout in ${LAYOUT_FILE}.`,
      crossesLayer: `The {{layer}} layer may not import {{target}}: only {{allowed}} (${LAYOUT_FILE}). If the dependency is real, pass it in as an option instead; if the layer graph should change, change the layout in review.`,
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const root = options.root ?? findRoot(context.cwd);
    const layout = options.layout ?? LAYOUT;

    if (!root) return {}; // harness/layout reports the missing root

    const workspaces = listWorkspaces(root);
    const file = context.filename;
    const from = workspaceOfFile({ workspaces, file });
    const entry = from && layout[from.name];

    if (!entry) return {}; // harness/layout reports a workspace the layout doesn't list

    const src = path.join(from.dir, 'src');
    const inSrc = file.startsWith(`${src}${path.sep}`);
    const isTestCode = TEST_CODE.test(toPosix(path.relative(from.dir, file)));
    const layers = entry.layers ?? {};
    const ownLayer = inSrc ? layerOf(toPosix(path.relative(src, file))) : null;

    const whyNot = (target) => {
      const targetEntry = layout[target];

      if (targetEntry?.kind === 'app') return 'Nothing imports an app.';

      if (entry.domain === 'generic' && targetEntry?.domain === 'coding') {
        return 'A generic workspace never imports a coding one.';
      }

      return 'If the dependency is real, add it to the layout in review.';
    };

    const checkPackage = (node, specifier) => {
      const target = Object.keys(layout).find(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );

      if (!target || target === from.name) return;

      if (layerEntry(layers[target] ?? []).testOnly) return;

      if (layout[target].testOnly && !isTestCode) {
        context.report({ node, messageId: 'testOnly', data: { target } });

        return;
      }

      if (!entry.dependsOn.includes(target)) {
        context.report({
          node,
          messageId: 'notInGraph',
          data: { from: from.name, target, why: whyNot(target) },
        });

        return;
      }

      if (ownLayer && ownLayer in layers && !isTestCode) {
        checkLayer({ node, target });
      }
    };

    const checkLayer = (params) => {
      const { node, target } = params;
      const own = layerEntry(layers[ownLayer]);

      if (target === ownLayer || own.dependsOn.includes(target)) return;

      context.report({
        node,
        messageId: 'crossesLayer',
        data: { layer: ownLayer, target, allowed: own.dependsOn.join(', ') || 'nothing' },
      });
    };

    const checkRelative = (node, specifier) => {
      const resolved = path.resolve(path.dirname(file), specifier);
      const to = workspaceOfFile({ workspaces, file: resolved });

      if (to?.dir !== from.dir) {
        context.report({
          node,
          messageId: 'crossesWorkspace',
          data: { from: from.name, target: to?.name ?? toPosix(path.relative(root, resolved)) },
        });

        return;
      }

      if (!ownLayer || !(ownLayer in layers) || isTestCode) return;
      if (!resolved.startsWith(`${src}${path.sep}`)) return;

      const target = layerOf(toPosix(path.relative(src, resolved)));
      const targetEntry = layers[target];

      if (targetEntry && layerEntry(targetEntry).testOnly) {
        context.report({ node, messageId: 'testOnly', data: { target: `src/${target}` } });

        return;
      }

      checkLayer({ node, target });
    };

    const check = (node, specifier) => {
      if (typeof specifier !== 'string') return;
      if (specifier.startsWith('.')) checkRelative(node, specifier);
      else checkPackage(node, specifier);
    };

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node, node.source.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => node.source.type === 'Literal' && check(node, node.source.value),
    };
  },
};
