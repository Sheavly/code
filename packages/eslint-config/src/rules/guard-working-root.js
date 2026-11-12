// A tool that resolves a path the agent gave it must start a relative path from the agents'
// working root, or the path means one thing to `set_working_root` and another to that tool. Every
// call to `resolveRead`, `resolveWrite` or `resolveDelete` in the coding package takes a path that
// went through `anchorToRoot`: either the call itself (`resolveRead(anchorToRoot({ ... }))`) or a
// variable declared earlier, in the same function or one around it, as `const x = anchorToRoot(...)`.
//
// It also rejects a `cwd: workspace.root` property (a process that ignores the root) and a literal
// `root: undefined` (a call that tells a helper there is no root), the two ways a tool skips it
// that a `resolve*` call does not show.
//
// Not covered, and left to review and the tests named here:
// - that the `root` handed to `anchorToRoot` is the conversation's current root: the helpers take
//   it as a required parameter, a caller can still pass a variable that is `undefined`, and
//   `working-root.tool.test.ts` runs every tool with a root set;
// - that a process's cwd is the root when it is built some other way than the exact text
//   `cwd: workspace.root`: `this.workspace.root`, `ws.root`, `workspace['root']`, a shorthand
//   `{ cwd }` after `const cwd = workspace.root` and a spread all pass, and so does `root: void 0`
//   or a `root` variable that is `undefined` (`working-root.tool.test.ts`, "grep and glob with a
//   working root", "run_command with a working root");
// - the `root: undefined` check fires for any property named `root` in the package's source, so
//   a source file that legitimately passes no root needs another name for it;
// - that the `.env` and `.git` checks run on the workspace-relative path and not only on a path
//   relative to the root (`resolveSearchRoot` does both; `working-root.tool.test.ts` and
//   `working-roots.service.test.ts` refuse `.git` as a root and as a search path);
// - `anchorToRoot` is matched by name, not by import, a `let` reassigned after its anchor still
//   counts as anchored, and a shadowing name can fool it;
// - a call through an alias (`const f = ws.resolveRead`) and a path built by hand and opened with
//   `node:fs`: `Workspace` confinement carries those.

import { calleeName, enclosingScope, scopeChain } from './call-scope.utils.js';

const MESSAGE =
  'A call to `resolveRead`, `resolveWrite` or `resolveDelete` needs a path that went through `anchorToRoot({ requested, root })` (`@sheavly/workspace/working-root/working-root.utils`), so a relative path starts from the working root: pass the call itself, or a variable declared earlier as `const anchored = anchorToRoot({ requested, root })`. See `read_file` or `resolveWritable`.';

const ROOT_CWD_MESSAGE =
  'A `cwd` set to `workspace.root` ignores the working root. Start the process in the folder `currentRoot` gives (the working root, else the workspace root), as `resolveSearchRoot` and `resolveCommandCwd` do.';

const ROOT_UNDEFINED_MESSAGE =
  'A literal `root: undefined` tells the helper there is no working root, whatever one is set. Pass the `root` the tool read with `currentRoot` once per call.';

const RESOLVERS = new Set(['resolveRead', 'resolveWrite', 'resolveDelete']);

/** The call a declarator is initialised with, seen through `await`. */
function initialisedCall(declarator) {
  const init =
    declarator.init?.type === 'AwaitExpression' ? declarator.init.argument : declarator.init;

  return init?.type === 'CallExpression' ? init : undefined;
}

export const guardWorkingRoot = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      unanchored: MESSAGE,
      rootCwd: ROOT_CWD_MESSAGE,
      rootUndefined: ROOT_UNDEFINED_MESSAGE,
    },
  },
  create(context) {
    const { sourceCode } = context;
    const resolves = [];
    const anchors = [];

    return {
      Property(node) {
        const name = node.computed ? undefined : node.key.name;

        // A process started with `cwd: workspace.root` ignores the working root, as grep and glob
        // did before it existed.
        if (name === 'cwd' && sourceCode.getText(node.value) === 'workspace.root') {
          context.report({ node, messageId: 'rootCwd' });
        }

        // A literal `root: undefined` hands a helper "no working root" whatever one is set.
        if (
          name === 'root' &&
          node.value.type === 'Identifier' &&
          node.value.name === 'undefined'
        ) {
          context.report({ node, messageId: 'rootUndefined' });
        }
      },
      CallExpression(node) {
        if (RESOLVERS.has(calleeName(node))) resolves.push(node);
      },
      VariableDeclarator(node) {
        const call = initialisedCall(node);

        if (node.id.type !== 'Identifier' || !call || calleeName(call) !== 'anchorToRoot') return;

        anchors.push({ node, name: node.id.name, scope: enclosingScope({ node, sourceCode }) });
      },
      'Program:exit'() {
        for (const resolve of resolves) {
          const [argument] = resolve.arguments;
          const chain = scopeChain({ node: resolve, sourceCode });
          const anchoredHere =
            argument?.type === 'CallExpression' && calleeName(argument) === 'anchorToRoot';
          const anchoredBefore =
            argument?.type === 'Identifier' &&
            anchors.some(
              (anchor) =>
                anchor.name === argument.name &&
                anchor.node.range[1] <= resolve.range[0] &&
                chain.includes(anchor.scope),
            );

          if (!anchoredHere && !anchoredBefore) {
            context.report({ node: resolve, messageId: 'unanchored' });
          }
        }
      },
    };
  },
};
