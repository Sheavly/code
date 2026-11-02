// Each workspace holds together as the layout reads it from the workspaces (`layout.utils.js`):
// it has a domain, is named after its folder, depends on no app, and a generic one on no coding
// one. In the app being split, every src/ folder or root file is one of its `layers`
// (`layout.js`). Reported on the workspace's own files, once each, with what to do.
import path from 'node:path';
import {
  entryProblems,
  LAYOUT_RULE_OPTIONS,
  listWorkspaces,
  readLayout,
  workspaceOfFile,
} from '../layout.utils.js';
import { findRoot } from './workspace-types.js';

const LAYERS_FILE = 'packages/eslint-config/src/layout.js';

/**
 * The src/ folder or root file `file` is in, when its workspace has `layers` (the app being split)
 * and that isn't one of them; null otherwise.
 */
function newLayer(params) {
  const { workspace, entry, file } = params;
  const layers = entry?.layers;
  const src = path.join(workspace.dir, 'src');

  if (!layers || !file.startsWith(`${src}${path.sep}`)) return null;

  const layer = path.relative(src, file).split(path.sep)[0];

  return layer in layers ? null : layer;
}

export const layoutRule = {
  meta: {
    type: 'problem',
    schema: [LAYOUT_RULE_OPTIONS],
    messages: {
      newLayer: `This file is in src/{{layer}}, which isn't one of {{name}}'s \`layers\` in ${LAYERS_FILE}, so its imports would go unchecked. Add the layer with what it may import (other layers and workspaces).`,
      broken: '{{problem}}.',
      noRoot:
        'harness/layout could not find the workspace root (a package.json with `workspaces`) above {{cwd}}. Pass `root`; it fails rather than skip, so no workspace goes unchecked.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const root = options.root ?? findRoot(context.cwd);

    return {
      Program: (node) => {
        const loc = { line: 1, column: 0 };

        if (!root) {
          context.report({ node, loc, messageId: 'noRoot', data: { cwd: context.cwd } });

          return;
        }

        const layout = options.layout ?? readLayout({ root, splitApp: options.splitApp });
        const workspace = workspaceOfFile({
          workspaces: listWorkspaces(root),
          file: context.filename,
        });
        const entry = workspace && layout[workspace.name];

        if (!entry) return; // outside every workspace: the layout check reports stray source

        for (const problem of entryProblems({ name: workspace.name, entry, layout })) {
          context.report({ node, loc, messageId: 'broken', data: { problem } });
        }

        const layer = newLayer({ workspace, entry, file: context.filename });

        if (layer) {
          context.report({
            node,
            loc,
            messageId: 'newLayer',
            data: { name: workspace.name, layer },
          });
        }
      },
    };
  },
};
