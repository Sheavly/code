const WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const NON_PROMPT_TYPES = new Set([
  'TSNumberKeyword',
  'TSBooleanKeyword',
  'TSVoidKeyword',
  'TSAnyKeyword',
  'TSUnknownKeyword',
  'TSNeverKeyword',
]);

export function unwrapPromptExpression(node) {
  return node && WRAPPERS.has(node.type) ? unwrapPromptExpression(node.expression) : node;
}

function isPromptReturnType(node) {
  if (!node || NON_PROMPT_TYPES.has(node.type)) return false;
  if (node.type === 'TSArrayType') return isPromptReturnType(node.elementType);
  if (node.type === 'TSUnionType') return node.types.every(isPromptReturnType);

  return true;
}

/** Rendering exports have explicit typed inputs/output; ordinary typed lint checks their bodies. */
function isTypedRenderer(node) {
  return (
    !node.async &&
    !node.generator &&
    isPromptReturnType(node.returnType?.typeAnnotation) &&
    node.params.every((parameter) => {
      const value = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;

      return Boolean(value.typeAnnotation);
    })
  );
}

function isPromptProperty(params) {
  const { property, bindings, seen } = params;

  if (property.type === 'SpreadElement') {
    return isPromptValue({ node: property.argument, bindings, seen, dataOnly: true });
  }

  return (
    property.type === 'Property' &&
    !property.computed &&
    property.kind === 'init' &&
    !property.method &&
    isPromptValue({ node: property.value, bindings, seen, dataOnly: true })
  );
}

function isPromptInterpolation(params) {
  const { bindings, seen = new Set() } = params;
  const node = unwrapPromptExpression(params.node);

  if (!node) return false;
  if (node.type === 'PromptConstantReference') return true;
  if (node.type === 'Literal') return ['string', 'number', 'boolean'].includes(typeof node.value);

  if (node.type === 'Identifier') {
    if (seen.has(node.name)) return false;

    return isPromptInterpolation({
      node: bindings.get(node.name),
      bindings,
      seen: new Set(seen).add(node.name),
    });
  }

  if (node.type === 'MemberExpression' && !node.computed) {
    return isPromptInterpolation({ node: node.object, bindings, seen });
  }

  if (node.type === 'BinaryExpression') {
    return (
      isPromptInterpolation({ node: node.left, bindings, seen }) &&
      isPromptInterpolation({ node: node.right, bindings, seen })
    );
  }

  return isPromptValue({ ...params, dataOnly: true });
}

function isPromptConcatenation(params) {
  const { node, bindings, seen } = params;
  const left = { node: node.left, bindings, seen, dataOnly: true };
  const right = { node: node.right, bindings, seen, dataOnly: true };

  return (
    node.operator === '+' &&
    ((isPromptValue(left) && isPromptInterpolation(right)) ||
      (isPromptInterpolation(left) && isPromptValue(right)))
  );
}

/** Authored text/data; imported constants may be interpolated but never exported as prompt data. */
export function isPromptValue(params) {
  const { bindings, seen = new Set(), dataOnly = false } = params;
  const node = unwrapPromptExpression(params.node);

  if (!node) return false;
  if (FUNCTIONS.has(node.type)) return !dataOnly && isTypedRenderer(node);

  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string';
    case 'TemplateLiteral':
      return node.expressions.every((expression) =>
        isPromptInterpolation({ node: expression, bindings, seen }),
      );

    case 'Identifier': {
      if (seen.has(node.name)) return false;

      const next = new Set(seen).add(node.name);

      return isPromptValue({ node: bindings.get(node.name), bindings, seen: next, dataOnly });
    }

    case 'CallExpression':
      return (
        node.callee.type === 'MemberExpression' &&
        !node.callee.computed &&
        ['join', 'concat'].includes(node.callee.property.name) &&
        isPromptValue({ node: node.callee.object, bindings, seen, dataOnly: true }) &&
        node.arguments.every((argument) =>
          isPromptValue({ node: argument, bindings, seen, dataOnly: true }),
        )
      );
    case 'BinaryExpression':
      return isPromptConcatenation({ node, bindings, seen });
    case 'ArrayExpression':
      return node.elements.every((element) =>
        isPromptValue({
          node: element?.type === 'SpreadElement' ? element.argument : element,
          bindings,
          seen,
          dataOnly: true,
        }),
      );
    case 'ObjectExpression':
      return (
        node.properties.length > 0 &&
        node.properties.every((property) => isPromptProperty({ property, bindings, seen }))
      );
    default:
      return false;
  }
}

function importedConstantBindings(statement) {
  if (
    statement.importKind === 'type' ||
    !/\.constants(?:\.(?:js|ts))?$/.test(statement.source.value)
  ) {
    return [];
  }

  return statement.specifiers
    .filter((specifier) => specifier.importKind !== 'type')
    .map((specifier) => [specifier.local.name, { type: 'PromptConstantReference' }]);
}

function bindingEntries(statement) {
  if (statement.type === 'ImportDeclaration') return importedConstantBindings(statement);

  const declaration =
    statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;

  if (declaration?.type === 'FunctionDeclaration') return [[declaration.id.name, declaration]];
  if (declaration?.type !== 'VariableDeclaration') return [];

  return declaration.declarations
    .filter((declarator) => declarator.id.type === 'Identifier')
    .map((declarator) => [declarator.id.name, declarator.init]);
}

/** Local named bindings for export specifiers and prompt fragments, independent of declaration order. */
export function promptBindings(program) {
  return new Map(program.body.flatMap(bindingEntries));
}

/** Exported runtime values only; types are checked by the common kind rule. */
export function promptExports(statement) {
  if (statement.type !== 'ExportNamedDeclaration' || statement.source) return [];

  const { declaration } = statement;

  if (declaration?.type === 'VariableDeclaration') {
    return declaration.declarations.map((node) => ({ node, value: node.init, name: node.id.name }));
  }

  if (declaration?.type === 'FunctionDeclaration') {
    return [{ node: declaration, value: declaration, name: declaration.id.name }];
  }

  if (declaration) return [];

  return statement.specifiers
    .filter((specifier) => statement.exportKind !== 'type' && specifier.exportKind !== 'type')
    .map((node) => ({ node, value: node.local, name: node.exported.name }));
}
