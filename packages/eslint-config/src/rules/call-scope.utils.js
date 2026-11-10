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
  return scopeChain(params)[0];
}

/** The scopes around a node, innermost first, ending with the program. */
export function scopeChain(params) {
  const { node, sourceCode } = params;

  return [
    ...sourceCode
      .getAncestors(node)
      .filter((ancestor) => FUNCTIONS.has(ancestor.type))
      .reverse(),
    sourceCode.ast,
  ];
}

/** The text of a named property of a call's options object, if it has one. */
export function propertyText(params) {
  const { node, sourceCode, name } = params;
  const [options] = node.arguments;

  if (options?.type !== 'ObjectExpression') return undefined;

  const property = options.properties.find(
    (entry) => entry.type === 'Property' && !entry.computed && entry.key.name === name,
  );

  return property ? sourceCode.getText(property.value) : undefined;
}

/** The name `const real = await x.resolveRead(...)` gives the result, if it is assigned. */
export function assignedName(node) {
  const value = node.parent.type === 'AwaitExpression' ? node.parent : node;
  const declarator = value.parent;

  return declarator.type === 'VariableDeclarator' && declarator.id.type === 'Identifier'
    ? declarator.id.name
    : undefined;
}
