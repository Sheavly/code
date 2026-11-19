// Which scoped run service a value stands for, by syntax alone (no type information): the value of
// `services.get(KEY)` / `services.find(KEY)` for a KEY imported from the contract, bound with a
// `const` or `let`, or a parameter or variable annotated with a scope type imported from the
// contract, looking through `?.`, `!`, `as`, `satisfies` and `<T>` casts. What the contract
// exports, and which key carries which type, is read from the extension package's files, so a new
// service is followed with no edit here. A variable is followed when every value written to it
// (its initialiser and each assignment, in any order, `undefined` and `null` aside) is a read of
// the same service; an annotated one also trusts its initialiser. A variable that is also
// assigned something else or another service is review-only. A value that is passed around,
// destructured, stored on an object or reached through a computed key is not followed: the
// caller sees no service for it.
import { findVariable } from './extension-source.utils.js';

const GETTERS = new Set(['get', 'find']);
const ABSENT = new Set(['TSUndefinedKeyword', 'TSNullKeyword']);

const TRANSPARENT = new Set([
  'ChainExpression',
  'TSNonNullExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
]);

/** The expression under `?.` chains, `!`, `as`, `satisfies` and `<T>` casts, which do not change what it is. */
function unwrap(node) {
  let current = node;

  while (TRANSPARENT.has(current.type)) current = current.expression;

  return current;
}

/** Whether `node` is `undefined` or `null`, which says nothing about which service a variable holds. */
function isAbsentValue(node) {
  const isUndefined = node.type === 'Identifier' && node.name === 'undefined';

  return isUndefined || (node.type === 'Literal' && node.value === null && node.raw === 'null');
}

/**
 * The value one write of a variable stores, with whether it is the declaration's own value (an
 * initialiser or a parameter default), or undefined when the write is not a plain value (a
 * destructuring, `++`, `+=`, a loop binding).
 */
function writeOf(reference) {
  const { identifier, writeExpr } = reference;
  const parent = identifier.parent;

  if (!writeExpr) return undefined;

  if (
    parent.type === 'VariableDeclarator' &&
    parent.id === identifier &&
    parent.init === writeExpr
  ) {
    return { value: writeExpr, declared: true };
  }

  if (parent.type === 'AssignmentPattern' && parent.left === identifier) {
    return { value: writeExpr, declared: true };
  }

  const plain = parent.type === 'AssignmentExpression' && parent.operator === '=';

  return plain && parent.left === identifier ? { value: writeExpr, declared: false } : undefined;
}

/** The names of `keys` grouped by the type they carry: a type two keys carry names both. */
function servicesByType(keys) {
  const byType = new Map();

  for (const { name, type } of keys.values()) byType.set(type, [...(byType.get(type) ?? []), name]);

  return byType;
}

/** The name `identifier` imports from the contract module that exposes it, else undefined. */
function importedContractName(params) {
  const { context, contract, identifier } = params;
  const variable = findVariable({
    scope: context.sourceCode.getScope(identifier),
    name: identifier.name,
  });
  const [definition] = variable?.defs ?? [];

  if (variable?.defs.length !== 1 || definition.type !== 'ImportBinding') return undefined;

  if (definition.node.type !== 'ImportSpecifier') return undefined;

  const { imported } = definition.node;
  const name = imported.type === 'Identifier' ? imported.name : String(imported.value);

  return contract.get(name) === definition.parent.source.value ? name : undefined;
}

/** The single type of an annotation, looking through `| undefined` and `| null`. */
function annotatedReference(type) {
  const members =
    type.type === 'TSUnionType' ? type.types.filter((m) => !ABSENT.has(m.type)) : [type];
  const [only] = members;

  return members.length === 1 &&
    only.type === 'TSTypeReference' &&
    only.typeName.type === 'Identifier'
    ? only.typeName
    : undefined;
}

/**
 * A reader of the services a value stands for: `serviceOf(expression)` is the list of service
 * names (empty when none can be told; two when one type is carried by two keys). `contract` maps
 * a name to the module that exposes it and `keys` is `readRunServices(root).keys`.
 */
export function scopeResolver(params) {
  const { context, contract, keys } = params;
  const byType = servicesByType(keys);
  const importedName = (identifier) => importedContractName({ context, contract, identifier });

  /** The service `get(KEY)` / `find(KEY)` reads, for a KEY imported from the contract. */
  function serviceOfKeyCall(call) {
    const { callee } = call;
    const [key] = call.arguments;

    if (callee.type !== 'MemberExpression' || callee.computed) return [];

    if (callee.property.type !== 'Identifier' || !GETTERS.has(callee.property.name)) return [];

    const name = key?.type === 'Identifier' ? importedName(key) : undefined;
    const service = name === undefined ? undefined : keys.get(name)?.name;

    return service === undefined ? [] : [service];
  }

  function serviceOfAnnotation(annotation) {
    const reference = annotation ? annotatedReference(annotation.typeAnnotation) : undefined;
    const name = reference ? importedName(reference) : undefined;

    return name === undefined ? [] : (byType.get(name) ?? []);
  }

  function serviceOfVariable(identifier) {
    const variable = findVariable({
      scope: context.sourceCode.getScope(identifier),
      name: identifier.name,
    });
    const [definition] = variable?.defs ?? [];

    if (variable?.defs.length !== 1) return [];

    const writes = variable.references.filter((reference) => reference.isWrite()).map(writeOf);

    // A write that is not a plain value (a destructuring, `++`, a loop binding) is not followed.
    if (writes.some((write) => write === undefined)) return [];

    const annotated = serviceOfAnnotation(definition.name.typeAnnotation);

    // The annotation vouches for what the variable starts as; only later assignments must agree.
    if (annotated.length > 0) {
      const shared = sharedServices(writes.filter((write) => !write.declared));

      return shared === undefined ? annotated : annotated.filter((s) => shared.includes(s));
    }

    return definition.type === 'Variable' ? (sharedServices(writes) ?? []) : [];
  }

  /**
   * The services every written value reads, `undefined` when no value reads one (only `undefined`
   * or `null` writes), `[]` when a value is not a scope read or two read different services.
   */
  function sharedServices(writes) {
    let common;

    for (const { value } of writes) {
      const node = unwrap(value);

      if (isAbsentValue(node)) continue;

      const services = node.type === 'CallExpression' ? serviceOfKeyCall(node) : [];

      common = (common ?? services).filter((service) => services.includes(service));

      if (common.length === 0) return [];
    }

    return common;
  }

  return {
    serviceOf(expression) {
      const node = unwrap(expression);

      if (node.type === 'CallExpression') return serviceOfKeyCall(node);

      return node.type === 'Identifier' ? serviceOfVariable(node) : [];
    },
  };
}
