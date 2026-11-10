// A tool that resolves a path for a write or a delete must go through the guarded resolvers in
// `@sheavly/coding/files/files.helper`, which refuse a `.env` file and `.git` on the path the model
// asked for and again on the real path `resolveWrite` / `resolveDelete` returns (a symlink can point
// at either). A delete must also remove the path `resolveDeletable` returned: `resolveWritable`
// follows a symlink and removes its target, which `resolveDelete` refuses. The helper itself is the
// one file the rule is off for, by a `files:` override.
//
// Not covered: a call through an alias (`const f = ws.resolveWrite`), and file changes that never
// call `Workspace`; `harness/no-direct-file-writes` and review carry those.

import {
  assignedName,
  calleeName,
  enclosingScope,
  propertyText,
  scopeChain,
} from './call-scope.utils.js';

const MESSAGE =
  'Call `resolveWritable` or `resolveDeletable` from `@sheavly/coding/files/files.helper` (`../files/files.helper.js`) instead of `Workspace.resolveWrite` / `resolveDelete`: they refuse a `.env` file and `.git` on both the requested path and the real path a symlink resolves to.';

const REMOVE_MESSAGE =
  'A delete removes the path `resolveDeletable` returned: `const real = await resolveDeletable({ workspace, requested })`, then `removeFile({ file: real, signal })`. `resolveDeletable` refuses a folder and a symlink; `resolveWritable` follows a symlink and would remove its target.';

/** The `Workspace` methods that resolve a path for a change without the `.env`/`.git` guards. */
const UNGUARDED_RESOLVERS = new Set(['resolveWrite', 'resolveDelete']);

export const guardEnvWrite = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { unguarded: MESSAGE, unguardedDelete: REMOVE_MESSAGE },
  },
  create(context) {
    const { sourceCode } = context;
    const deletes = [];
    const removes = [];

    return {
      CallExpression(node) {
        const name = calleeName(node);

        if (UNGUARDED_RESOLVERS.has(name)) context.report({ node, messageId: 'unguarded' });

        if (name === 'resolveDeletable') {
          deletes.push({
            node,
            scope: enclosingScope({ node, sourceCode }),
            name: assignedName(node),
          });
        }

        if (name === 'removeFile') removes.push(node);
      },
      'Program:exit'() {
        for (const remove of removes) {
          const scopes = scopeChain({ node: remove, sourceCode });
          const file = propertyText({ node: remove, sourceCode, name: 'file' });
          const guarded = deletes.some(
            (entry) =>
              scopes.includes(entry.scope) &&
              entry.name !== undefined &&
              entry.name === file &&
              entry.node.range[1] <= remove.range[0],
          );

          if (!guarded) context.report({ node: remove, messageId: 'unguardedDelete' });
        }
      },
    };
  },
};
