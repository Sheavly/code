// A tool that resolves a path for a write or a delete must go through the guarded resolvers in
// `@sheavly/coding/files/files.helper`, which refuse a `.env` file and `.git` on the path the model
// asked for and again on the real path `resolveWrite` / `resolveDelete` returns (a symlink can point
// at either). The effects that change a file take the path their resolver returned: a delete
// through `resolveWritable` would remove a symlink's target, which `resolveDelete` refuses, and a
// hand-built path skips the guards. The helper itself is the one file the rule is off for, by a
// `files:` override.
//
// Not covered: a call through an alias (`const f = ws.resolveWrite`), and file changes that never
// call `Workspace`; `harness/no-direct-file-writes` and review carry those.

import { assignedName, calleeName, propertyText, scopeChain } from './call-scope.utils.js';

const MESSAGE =
  'Call `resolveWritable` or `resolveDeletable` from `@sheavly/coding/files/files.helper` (`../files/files.helper.js`) instead of `Workspace.resolveWrite` / `resolveDelete`: they refuse a `.env` file and `.git` on both the requested path and the real path a symlink resolves to.';

const WRITE_MESSAGE =
  'A write changes the path `resolveWritable` returned: `const real = await resolveWritable({ workspace, requested })`, then `writeText` or `createParentFolder` with `file: real`. A hand-built path, or one from another resolver, skips the `.env`/`.git` guards.';

const REMOVE_MESSAGE =
  'A delete removes the path `resolveDeletable` returned: `const real = await resolveDeletable({ workspace, requested })`, then `removeFile({ file: real, signal })`. `resolveDeletable` refuses a folder and a symlink; `resolveWritable` follows a symlink and would remove its target.';

/** The `Workspace` methods that resolve a path for a change without the `.env`/`.git` guards. */
const UNGUARDED_RESOLVERS = new Set(['resolveWrite', 'resolveDelete']);

/** Each effect that changes a file, and the resolver whose returned path it may take. */
const EFFECTS = new Map([
  ['writeText', { resolver: 'resolveWritable', messageId: 'unguardedWrite' }],
  ['createParentFolder', { resolver: 'resolveWritable', messageId: 'unguardedWrite' }],
  ['removeFile', { resolver: 'resolveDeletable', messageId: 'unguardedDelete' }],
]);

export const guardEnvWrite = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      unguarded: MESSAGE,
      unguardedWrite: WRITE_MESSAGE,
      unguardedDelete: REMOVE_MESSAGE,
    },
  },
  create(context) {
    const { sourceCode } = context;
    const resolvers = [];
    const effects = [];

    return {
      CallExpression(node) {
        const name = calleeName(node);

        if (UNGUARDED_RESOLVERS.has(name)) context.report({ node, messageId: 'unguarded' });

        if (name === 'resolveWritable' || name === 'resolveDeletable') {
          resolvers.push({
            node,
            resolver: name,
            scope: scopeChain({ node, sourceCode })[0],
            name: assignedName(node),
          });
        }

        if (EFFECTS.has(name)) effects.push(node);
      },
      'Program:exit'() {
        for (const effect of effects) {
          const { resolver, messageId } = EFFECTS.get(calleeName(effect));
          const scopes = scopeChain({ node: effect, sourceCode });
          const file = propertyText({ node: effect, sourceCode, name: 'file' });
          const guarded = resolvers.some(
            (entry) =>
              entry.resolver === resolver &&
              scopes.includes(entry.scope) &&
              entry.name !== undefined &&
              entry.name === file &&
              entry.node.range[1] <= effect.range[0],
          );

          if (!guarded) context.report({ node: effect, messageId });
        }
      },
    };
  },
};
