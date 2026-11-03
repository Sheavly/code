// Each workspace holds together as the layout reads it from the workspaces (`layout.utils.js`):
// it has a domain, is named after its folder, depends on no app, and a generic one on no coding
// one. Reported on the workspace's own files, once each, with what to do.
import {
  entryProblems,
  LAYOUT_RULE_OPTIONS,
  listWorkspaces,
  readLayout,
  workspaceOfFile,
} from '../layout.utils.js';
import { findRoot } from './workspace-types.js';

export const layoutRule = {
  meta: {
    type: 'problem',
    schema: [LAYOUT_RULE_OPTIONS],
    messages: {
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

        const layout = options.layout ?? readLayout({ root });
        const workspace = workspaceOfFile({
          workspaces: listWorkspaces(root),
          file: context.filename,
        });
        const entry = workspace && layout[workspace.name];

        if (!entry) return; // outside every workspace: the layout check reports stray source

        for (const problem of entryProblems({ name: workspace.name, entry, layout })) {
          context.report({ node, loc, messageId: 'broken', data: { problem } });
        }
      },
    };
  },
};
