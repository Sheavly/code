// Finds where an `*ExtensionOptions` declaration names a type a run service carries. Matching is by
// type NAME: a differently named but structurally identical type is not found, and a name the file
// declares itself (a local type or a generic parameter) is not the host's type.

const MEMBER_TYPES = new Set([
  'TSPropertySignature',
  'TSMethodSignature',
  'TSIndexSignature',
  'TSCallSignatureDeclaration',
  'TSConstructSignatureDeclaration',
]);

const LOCAL_DECLARATIONS = new Set([
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
  'TSEnumDeclaration',
  'TSModuleDeclaration',
  'ClassDeclaration',
]);

/** The AST children of `node`; `parent` is skipped so a walk never loops. */
function childrenOf(node) {
  return Object.entries(node)
    .filter(([key]) => key !== 'parent')
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter((value) => typeof value?.type === 'string');
}

/** Every node under `node`, itself included. */
function descendantsOf(node) {
  return [node, ...childrenOf(node).flatMap((child) => descendantsOf(child))];
}

function identifierName(node) {
  return node.type === 'Identifier' ? node.name : undefined;
}

/** The names a file declares itself, and the generic parameters declared anywhere inside `node`. */
function localNamesOf(params) {
  const { ast, declaration } = params;
  const names = new Set();

  for (const statement of ast.body) {
    const inner = statement.declaration ?? statement;

    if (LOCAL_DECLARATIONS.has(inner.type) && inner.id) names.add(identifierName(inner.id));
  }

  for (const node of descendantsOf(declaration)) {
    if (node.type === 'TSTypeParameter') {
      names.add(typeof node.name === 'string' ? node.name : identifierName(node.name));
    }
  }

  return names;
}

/** The leftmost identifier of a (qualified) name, and the name matched: its right-hand part. */
function namesOf(typeName) {
  if (typeName.type === 'Identifier') return { root: typeName.name, name: typeName.name };

  if (typeName.type === 'TSQualifiedName') {
    return { root: namesOf(typeName.left).root, name: typeName.right.name };
  }

  if (typeName.type === 'MemberExpression') {
    return { root: namesOf(typeName.object).root, name: typeName.property.name };
  }

  return {};
}

/** The name `node` refers to when it is itself a type reference, import type or `extends` entry. */
function referenceOf(node) {
  if (node.type === 'TSTypeReference') return namesOf(node.typeName);
  if (node.type === 'TSInterfaceHeritage') return namesOf(node.expression);
  if (node.type === 'TSImportType' && node.qualifier) return namesOf(node.qualifier);

  return {};
}

/** The service type `node` itself names (not a local one), or undefined. */
function serviceNamed(params) {
  const { node, services, locals } = params;
  const { root, name } = referenceOf(node);

  if (!name || locals.has(root)) return undefined;

  return services.has(name) ? name : undefined;
}

/** The first service type `node` mentions (a reference anywhere inside it), or undefined. */
function mentionedService(params) {
  const own = serviceNamed(params);

  if (own) return own;

  for (const child of childrenOf(params.node)) {
    const found = mentionedService({ ...params, node: child });

    if (found) return found;
  }

  return undefined;
}

function memberName(member) {
  if (member.type === 'TSIndexSignature') return `[${member.parameters[0]?.name ?? 'key'}: …]`;
  if (member.type === 'TSCallSignatureDeclaration') return '(call signature)';
  if (member.type === 'TSConstructSignatureDeclaration') return '(construct signature)';

  const { key } = member;

  return key.type === 'Identifier' && !member.computed ? key.name : `[${String(key.value)}]`;
}

/**
 * The places `node` names a service type, as `{ node, name, type }`. A member (property, method,
 * index, call or construct signature) is reported once, by its own name, and not entered again, so
 * a nested literal counts as the member that holds it. A bare reference outside any member (an
 * alias body, an `extends` entry, a generic constraint or default) is reported under `fallback`.
 */
function mentionsIn(params) {
  const { node, fallback } = params;

  if (MEMBER_TYPES.has(node.type)) {
    const type = mentionedService(params);

    return type ? [{ node, name: memberName(node), type }] : [];
  }

  const type = serviceNamed(params);

  if (type) {
    const name = node.type === 'TSInterfaceHeritage' ? `extends ${type}` : fallback;

    return [{ node, name, type }];
  }

  return childrenOf(node).flatMap((child) => mentionsIn({ ...params, node: child }));
}

function parametersOf(declaration) {
  return declaration.typeParameters?.params ?? [];
}

/** Constraint and default of each generic parameter, reported under the parameter's name. */
function parameterMentions(params) {
  const { declaration, services, locals } = params;

  return parametersOf(declaration).flatMap((parameter) => {
    const fallback = typeof parameter.name === 'string' ? parameter.name : parameter.name.name;

    return [parameter.constraint, parameter.default]
      .filter(Boolean)
      .flatMap((node) => mentionsIn({ node, fallback, services, locals }));
  });
}

/**
 * Every place the options type `declaration` (an alias or interface) names a service type:
 * members, an alias body, `extends` entries, and generic parameter constraints and defaults.
 */
export function serviceMentionsIn(params) {
  const { ast, declaration, services } = params;
  const locals = localNamesOf({ ast, declaration });
  const fallback = declaration.id.name;
  const parts =
    declaration.type === 'TSInterfaceDeclaration'
      ? [...(declaration.extends ?? []), declaration.body]
      : [declaration.typeAnnotation];

  return [
    ...parameterMentions({ declaration, services, locals }),
    ...parts.flatMap((node) => mentionsIn({ node, fallback, services, locals })),
  ];
}
