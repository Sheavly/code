// Every workspace has an entry in the layout (`layout.js`), and the layout itself holds together
// (its graph points down, no workspace imports an app, generic never imports coding). Reported
// once per file, on the file's first line, with what to add.
import { LAYOUT } from '../layout.js';
import { layoutProblems, listWorkspaces, workspaceOfFile } from '../layout.utils.js';
import { findRoot } from './workspace-types.js';

const LAYOUT_FILE = 'packages/eslint-config/src/layout.js';

export const layoutRule = {
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
      missing: `This file is in the workspace {{name}} ({{dir}}), which ${LAYOUT_FILE} doesn't list. Add its entry: \`kind\` (package or app), \`domain\` (generic, coding or tooling) and \`dependsOn\` (the @sheavly/* workspaces it may import).`,
      broken: `${LAYOUT_FILE} doesn't hold together: {{problem}}. Fix the entry.`,
      noRoot:
        'harness/layout could not find the workspace root (a package.json with `workspaces`) above {{cwd}}. Pass `root`; it fails rather than skip, so no workspace goes unchecked.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const root = options.root ?? findRoot(context.cwd);
    const layout = options.layout ?? LAYOUT;

    return {
      Program: (node) => {
        const loc = { line: 1, column: 0 };

        if (!root) {
          context.report({ node, loc, messageId: 'noRoot', data: { cwd: context.cwd } });

          return;
        }

        for (const problem of layoutProblems(layout)) {
          context.report({ node, loc, messageId: 'broken', data: { problem } });
        }

        const workspace = workspaceOfFile({
          workspaces: listWorkspaces(root),
          file: context.filename,
        });

        if (workspace && !(workspace.name in layout)) {
          context.report({
            node,
            loc,
            messageId: 'missing',
            data: { name: workspace.name, dir: workspace.relative },
          });
        }
      },
    };
  },
};
