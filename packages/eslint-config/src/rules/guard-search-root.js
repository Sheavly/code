// ripgrep applies its `.env` and `.git` excludes to what it walks, never to a root path it is
// given, so a tool that runs it on a path the model chose must first check that path with
// `resolveSearchRoot` (workspace confinement, `.env`, `.git`, symlinks). `grep` and `glob` do; the
// next ripgrep tool has to, and only a check can make sure it does.
//
// For each `runRipgrep(...)` call: a `resolveSearchRoot(...)` call earlier in the same function,
// as a statement of its own (`const root = await resolveSearchRoot(...)`), not in a branch, which
// may not run. Not covered: that its result is the path handed to ripgrep, a call through an
// alias, a `runRipgrep` inside a callback of the checked function, and a ripgrep run that skips
// `runRipgrep`; review carries those.

import { calleeName, enclosingScope } from './call-scope.utils.js';

const MESSAGE =
  'A call to `runRipgrep` needs `resolveSearchRoot({ workspace, requested })` as a statement of its own earlier in the same function (not in a branch): ripgrep does not apply its `.env` and `.git` excludes to a root path it is given, and the search path passed to it must be the result. See `grep` or `glob`.';

const WRAPPERS = new Set(['AwaitExpression', 'VariableDeclarator']);
const STATEMENTS = new Set(['ExpressionStatement', 'VariableDeclaration']);

/** True if the call, only wrapped in `await` or a declaration, is a statement of the scope's own body. */
function isTopLevelStatement(params) {
  const { node, scope } = params;
  const body = scope.type === 'Program' ? scope : scope.body;
  let statement = node.parent;

  while (WRAPPERS.has(statement.type)) statement = statement.parent;

  return STATEMENTS.has(statement.type) && statement.parent === body;
}

export const guardSearchRoot = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { unguarded: MESSAGE },
  },
  create(context) {
    const { sourceCode } = context;
    const runs = [];
    const checks = [];

    return {
      CallExpression(node) {
        const name = calleeName(node);

        if (name === 'runRipgrep') runs.push(node);

        if (name === 'resolveSearchRoot') {
          checks.push({ node, scope: enclosingScope({ node, sourceCode }) });
        }
      },
      'Program:exit'() {
        for (const run of runs) {
          const scope = enclosingScope({ node: run, sourceCode });
          const checked = checks.some(
            (check) =>
              check.scope === scope &&
              check.node.range[1] <= run.range[0] &&
              isTopLevelStatement({ node: check.node, scope }),
          );

          if (!checked) context.report({ node: run, messageId: 'unguarded' });
        }
      },
    };
  },
};
