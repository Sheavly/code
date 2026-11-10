// A tool that resolves a path for reading must refuse `.env` files twice: on the path the model
// asked for (before touching the disk) and on the real path `resolveRead` returns (a symlink can
// point at one). `read_file` and `grep` do; the next tool that reads or searches files has to, and
// only a check can make sure it does.
//
// For each `resolveRead(requested)` call, in the same function: a top-level
// `assertNotEnvFile({ filePath: requested })` before it, and a top-level
// `assertNotEnvFile({ filePath: real })` after it, where `real` is the variable it is assigned to.
// A guard on another value, in another function, inside a branch, or on a path that was never
// assigned fails. Not covered: a call through an alias (`const f = ws.resolveRead`), and reads
// that skip `Workspace` (`node:fs` on a path built by hand); `Workspace` confinement and review
// carry those.

const MESSAGE =
  'A call to `resolveRead` needs the `.env` guard on both sides, in the same function: `assertNotEnvFile({ filePath: <the requested path> })` before it, and `assertNotEnvFile({ filePath: <the variable it is assigned to> })` after it, each as a statement of its own (not in a branch), since a symlink can point at a `.env` file (`@sheavly/coding/files/files.utils`). See `read_file` or `grep`.';

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** The called method's name: `x.name(...)`, `x['name'](...)` or `name(...)`. */
function calleeName(node) {
  const { callee } = node;

  if (callee.type === 'Identifier') return callee.name;

  if (callee.type !== 'MemberExpression') return undefined;

  if (!callee.computed) return callee.property.name;

  return callee.property.type === 'Literal' ? callee.property.value : undefined;
}

/** The text of the `filePath` property of a guard call's options object, if it has one. */
function guardedPath(params) {
  const { node, sourceCode } = params;
  const [options] = node.arguments;

  if (options?.type !== 'ObjectExpression') return undefined;

  const property = options.properties.find(
    (entry) => entry.type === 'Property' && !entry.computed && entry.key.name === 'filePath',
  );

  return property ? sourceCode.getText(property.value) : undefined;
}

/** The function a node is in, or the program. */
function enclosingScope(params) {
  const { node, sourceCode } = params;

  return (
    sourceCode
      .getAncestors(node)
      .reverse()
      .find((ancestor) => FUNCTIONS.has(ancestor.type)) ?? sourceCode.ast
  );
}

/** True if the call is a statement of its own directly in the scope's body, not in a branch. */
function isTopLevelStatement(params) {
  const { node, scope } = params;
  const statement = node.parent;
  const body = scope.type === 'Program' ? scope : scope.body;

  return statement.type === 'ExpressionStatement' && statement.parent === body;
}

/** The name `const real = await x.resolveRead(...)` gives the real path, if it is assigned. */
function assignedName(node) {
  const value = node.parent.type === 'AwaitExpression' ? node.parent : node;
  const declarator = value.parent;

  return declarator.type === 'VariableDeclarator' && declarator.id.type === 'Identifier'
    ? declarator.id.name
    : undefined;
}

export const guardEnvRead = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { unguarded: MESSAGE },
  },
  create(context) {
    const { sourceCode } = context;
    const resolves = [];
    const guards = [];

    return {
      CallExpression(node) {
        const name = calleeName(node);

        if (name === 'resolveRead') resolves.push(node);

        if (name === 'assertNotEnvFile') {
          guards.push({
            node,
            scope: enclosingScope({ node, sourceCode }),
            path: guardedPath({ node, sourceCode }),
          });
        }
      },
      'Program:exit'() {
        for (const resolve of resolves) {
          const scope = enclosingScope({ node: resolve, sourceCode });
          const requested = resolve.arguments[0] && sourceCode.getText(resolve.arguments[0]);
          const real = assignedName(resolve);
          const guarded = (predicate) =>
            guards.some(
              (guard) =>
                guard.scope === scope &&
                isTopLevelStatement({ node: guard.node, scope }) &&
                predicate(guard),
            );
          const before = guarded(
            (guard) => guard.node.range[1] <= resolve.range[0] && guard.path === requested,
          );
          const after = guarded(
            (guard) => guard.node.range[0] >= resolve.range[1] && guard.path === real,
          );

          if (!before || !after || real === undefined) {
            context.report({ node: resolve, messageId: 'unguarded' });
          }
        }
      },
    };
  },
};
