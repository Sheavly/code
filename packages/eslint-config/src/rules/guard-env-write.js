// A tool that resolves a path for a write or a delete must go through the guarded resolvers in
// `@sheavly/coding/files/files.helper`, which refuse a `.env` file and `.git` on the path the model
// asked for and again on the real path `resolveWrite` / `resolveDelete` returns (a symlink can point
// at either). A direct call skips both guards, and the next tool that changes files has to go
// through them. The helper itself is the one file the rule is off for, by a `files:` override.
//
// Not covered: a call through an alias (`const f = ws.resolveWrite`), and file changes that never
// call `Workspace`; `harness/no-direct-file-writes` and review carry those.

import { calleeName } from './call-scope.utils.js';

const MESSAGE =
  'Call `resolveWritable` or `resolveDeletable` from `@sheavly/coding/files/files.helper` (`../files/files.helper.js`) instead of `Workspace.resolveWrite` / `resolveDelete`: they refuse a `.env` file and `.git` on both the requested path and the real path a symlink resolves to.';

/** The `Workspace` methods that resolve a path for a change without the `.env`/`.git` guards. */
const UNGUARDED_RESOLVERS = new Set(['resolveWrite', 'resolveDelete']);

export const guardEnvWrite = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { unguarded: MESSAGE },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (UNGUARDED_RESOLVERS.has(calleeName(node))) {
          context.report({ node, messageId: 'unguarded' });
        }
      },
    };
  },
};
