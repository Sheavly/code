const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** The called method's name: `x.name(...)`, `x['name'](...)` or `name(...)`. */
export function calleeName(node) {
  const { callee } = node;

  if (callee.type === 'Identifier') return callee.name;

  if (callee.type !== 'MemberExpression') return undefined;

  if (!callee.computed) return callee.property.name;

  return callee.property.type === 'Literal' ? callee.property.value : undefined;
}

/** The function a node is in, or the program. */
export function enclosingScope(params) {
  const { node, sourceCode } = params;

  return (
    sourceCode
      .getAncestors(node)
      .reverse()
      .find((ancestor) => FUNCTIONS.has(ancestor.type)) ?? sourceCode.ast
  );
}
