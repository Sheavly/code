import { FILE_KIND_POLICIES, kindOfFile } from '../file-kinds.js';
import { isPromptValue, promptBindings, promptExports } from './prompt-shape.utils.js';

// What a file may export follows from its kind's `exports` policy in file-kinds.js, and whether
// it may hold literal constants at all from its `constantsElsewhere` policy. Non-exported types
// and computed values may stay next to the code that uses them.

const WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion']);

function unwrap(node) {
  return WRAPPERS.has(node.type) ? unwrap(node.expression) : node;
}

/** A value fixed at authoring time: literals, and arrays/objects/templates made of them. */
function isLiteralValue(node) {
  const value = unwrap(node);

  switch (value.type) {
    case 'Literal':
      return true;
    case 'TemplateLiteral':
      return value.expressions.every(isLiteralOrReference);
    case 'UnaryExpression':
      return isLiteralValue(value.argument);
    case 'ArrayExpression':
      return value.elements.every((element) => element && isLiteralOrReference(element));
    case 'ObjectExpression':
      return value.properties.every((property) => {
        if (property.type === 'SpreadElement') return isLiteralOrReference(property.argument);

        const isKeyFixed = !property.computed || isLiteralOrReference(property.key);

        return isKeyFixed && isLiteralOrReference(property.value);
      });
    case 'BinaryExpression':
      return isLiteralOrReference(value.left) && isLiteralOrReference(value.right);
    default:
      return false;
  }
}

/** Inside a literal, `OTHER_CONSTANT` / `X.Y` are references to constants. */
function isLiteralOrReference(node) {
  const value = unwrap(node);

  if (value.type === 'Identifier') return true;

  if (value.type === 'MemberExpression') {
    return !value.computed && isLiteralOrReference(value.object);
  }

  return isLiteralValue(value);
}

const TYPE_DECLARATIONS = new Set([
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
  'TSModuleDeclaration',
  'TSDeclareFunction',
]);

/** Compatibility aliases expose adjacent prompt text without exposing renderers or other code. */
function isImportedPromptLiteral(params) {
  const { node, sourceCode } = params;
  const services = sourceCode?.parserServices;

  if (node?.type !== 'Identifier' || !services?.program || !services.esTreeNodeToTSNodeMap) {
    return false;
  }

  let scope = sourceCode.getScope(node);
  let binding;

  while (scope && !binding) {
    binding = scope.set.get(node.name);
    scope = scope.upper;
  }

  const definition = binding?.defs[0];
  const specifier = definition?.node;
  const declaration = specifier?.parent;

  if (definition?.type !== 'ImportBinding' || specifier.type !== 'ImportSpecifier') return false;
  if (specifier.importKind === 'type' || declaration.importKind === 'type') return false;
  if (!/^\.\/[^/]+\.prompt\.(?:js|ts)$/u.test(declaration.source.value)) return false;

  const tsNode = services.esTreeNodeToTSNodeMap.get(node);

  return (
    Boolean(tsNode) && services.program.getTypeChecker().getTypeAtLocation(tsNode).isStringLiteral()
  );
}

/** Each export of a statement as `{ node, name, shape }`, shape one of type/literal/code. */
function describeExports(params) {
  const { statement, sourceCode } = params;

  if (statement.type !== 'ExportNamedDeclaration') return [];

  const { declaration } = statement;

  if (!declaration) {
    return statement.specifiers.map((specifier) => ({
      node: specifier,
      name: specifier.exported.name,
      shape: statement.exportKind === 'type' || specifier.exportKind === 'type' ? 'type' : 'code',
    }));
  }

  if (TYPE_DECLARATIONS.has(declaration.type)) {
    return [{ node: declaration, name: declaration.id?.name, shape: 'type' }];
  }

  if (declaration.type === 'TSEnumDeclaration') {
    return [{ node: declaration, name: declaration.id.name, shape: 'literal' }];
  }

  if (declaration.type !== 'VariableDeclaration') {
    return [{ node: declaration, name: declaration.id?.name, shape: 'code' }];
  }

  return declaration.declarations.map((declarator) => ({
    node: declarator,
    name: declarator.id.name,
    shape:
      declarator.init &&
      (isLiteralValue(declarator.init) ||
        (declaration.kind === 'const' &&
          isImportedPromptLiteral({ node: declarator.init, sourceCode })))
        ? 'literal'
        : 'code',
  }));
}

const VIOLATIONS = {
  types: { literal: 'valueInTypes', code: 'valueInTypes' },
  constants: { type: 'typeInConstants', code: 'codeInConstants' },
  code: { type: 'typeInCode', literal: 'literalInCode' },
  prompt: { type: 'typeInCode' },
};

function isValueImport(statement) {
  if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') return false;

  return (
    statement.specifiers.length === 0 ||
    statement.specifiers.some((specifier) => specifier.importKind !== 'type')
  );
}

/** The local names bound to zod in this file (`import { z } from 'zod'`, `import * as z`). */
function zodNames(program) {
  const names = new Set();

  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== 'zod') continue;
    if (statement.importKind === 'type') continue;

    for (const specifier of statement.specifiers) {
      if (specifier.importKind === 'type') continue;

      if (specifier.type === 'ImportNamespaceSpecifier' || specifier.imported?.name === 'z') {
        names.add(specifier.local.name);
      }
    }
  }

  return names;
}

/**
 * Calls and reads that turn a schema into something else: parsed data, a parse result, its
 * shape, its JSON Schema. A chain through one of these isn't a schema, whatever it started from.
 * Members that return a schema in zod 4 (`.keyof()`, `.element`, `.meta({...})`) are not here.
 */
const SCHEMA_TO_VALUE = new Set([
  'parse',
  'safeParse',
  'parseAsync',
  'safeParseAsync',
  'spa',
  'decode',
  'safeDecode',
  'decodeAsync',
  'safeDecodeAsync',
  'encode',
  'safeEncode',
  'encodeAsync',
  'safeEncodeAsync',
  'shape',
  'def',
  'options',
  'toJSONSchema',
  'description',
]);

/** `x.meta()` with no argument: it returns the metadata, not a schema. */
function isBareMetaCall(call) {
  const callee = unwrap(call.callee);

  return (
    callee.type === 'MemberExpression' &&
    propertyName(callee) === 'meta' &&
    call.arguments.length === 0
  );
}

/** The property a member access reads, if it is a fixed name: `a.parse` → `parse`. */
function propertyName(member) {
  if (member.computed) {
    return member.property.type === 'Literal' ? member.property.value : undefined;
  }

  return member.property.name;
}

/**
 * The identifiers a value is built from: a member/call chain's root (`z.object({}).strict()` →
 * `z`, `base.extend({})` → `base`), and both branches of a conditional. A chain through a parse
 * or read (`base.parse(x)`, `base.shape`) has none: its result is data, not a schema.
 */
function chainRoots(node) {
  const value = unwrap(node);

  switch (value.type) {
    case 'Identifier':
      return [value.name];
    case 'CallExpression':
      // `.meta()` with no argument reads the metadata; `.meta({...})` returns a schema.
      if (isBareMetaCall(value)) return [];

      return chainRoots(value.callee);
    case 'MemberExpression':
      return SCHEMA_TO_VALUE.has(propertyName(value)) ? [] : chainRoots(value.object);
    case 'ConditionalExpression':
      return [...chainRoots(value.consequent), ...chainRoots(value.alternate)];
    case 'LogicalExpression':
      return [...chainRoots(value.left), ...chainRoots(value.right)];
    default:
      return [];
  }
}

function isClassNode(node) {
  const value = node && unwrap(node);

  return value?.type === 'ClassDeclaration' || value?.type === 'ClassExpression';
}

/** The top-level variable declarators and class declarations of a statement, exported or not. */
function topLevelBindings(statement) {
  const declaration =
    statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
      ? statement.declaration
      : statement;

  if (declaration?.type === 'VariableDeclaration') {
    return declaration.declarations
      .filter((declarator) => declarator.id.type === 'Identifier')
      .map((declarator) => ({ name: declarator.id.name, init: declarator.init, node: declarator }));
  }

  if (declaration?.type === 'ClassDeclaration' && declaration.id) {
    return [{ name: declaration.id.name, init: declaration, node: declaration }];
  }

  return [];
}

/**
 * The file's top-level classes and zod schemas, by local name. A schema is a value built from
 * zod, or from another schema in this file (`base.extend({})`, `base.optional()`), so a derived
 * schema counts too. Declarations are read in order, then again until nothing new is found, so
 * one built from a schema declared later is still caught.
 */
function classesAndSchemas(program) {
  const zod = zodNames(program);
  const bindings = program.body.flatMap(topLevelBindings);
  const classes = new Set(bindings.filter(({ init }) => isClassNode(init)).map(({ name }) => name));
  const schemas = new Set();
  let grew = true;

  while (grew) {
    grew = false;

    for (const { name, init } of bindings) {
      if (!init || schemas.has(name) || isClassNode(init)) continue;

      if (chainRoots(init).some((root) => zod.has(root) || schemas.has(root))) {
        schemas.add(name);
        grew = true;
      }
    }
  }

  return { classes, schemas };
}

/**
 * What one statement exports, as classes and schemas: `export class X`, `export const x = z…`,
 * `export default class`, and specifiers (`export { X, x as y }`), each resolved to the local
 * declaration it names.
 */
function exportedKinds(params) {
  const { statement, local } = params;
  const classes = [];
  const schemas = [];
  const add = (entry) => {
    if (local.classes.has(entry.local)) classes.push(entry);
    if (local.schemas.has(entry.local)) schemas.push(entry);
  };

  if (statement.type === 'ExportDefaultDeclaration') {
    const { declaration } = statement;

    if (isClassNode(declaration)) {
      classes.push({ node: declaration, name: declaration.id?.name ?? 'default' });
    } else if (declaration.type === 'Identifier') {
      add({ node: declaration, name: 'default', local: declaration.name });
    }

    return { classes, schemas };
  }

  if (statement.type !== 'ExportNamedDeclaration' || statement.source) return { classes, schemas };

  if (statement.declaration) {
    for (const { name, node } of topLevelBindings(statement)) add({ node, name, local: name });
  }

  for (const specifier of statement.specifiers) {
    if (statement.exportKind === 'type' || specifier.exportKind === 'type') continue;

    add({ node: specifier, name: specifier.exported.name, local: specifier.local.name });
  }

  return { classes, schemas };
}

/**
 * Top-level `const` declarators of a statement that is not exported and holds a literal value:
 * the constants a code file keeps to itself.
 */
function privateLiteralConstants(statement) {
  if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') return [];

  return statement.declarations.filter(
    (declarator) =>
      declarator.id.type === 'Identifier' && declarator.init && isLiteralValue(declarator.init),
  );
}

/** Literal constants of a code file belong in the module's `*.constants.ts`, exported or not. */
function checkPrivateLiterals(params) {
  const { context, program, kind } = params;

  if (!FILE_KIND_POLICIES[kind].constantsElsewhere) return;

  for (const statement of program.body) {
    for (const declarator of privateLiteralConstants(statement)) {
      context.report({
        node: declarator,
        messageId: 'literalConstantInCode',
        data: { name: declarator.id.name, kind },
      });
    }
  }
}

/** Class and schema rules from the kind's `classes` / `schemas` policy, for one file. */
function checkKindShape(params) {
  const { context, program, kind } = params;

  if (kind === 'prompt') return;

  const {
    classes: classPolicy,
    schemas: schemaPolicy,
    exports: exportPolicy,
  } = FILE_KIND_POLICIES[kind];
  const local = classesAndSchemas(program);
  let classCount = 0;

  for (const statement of program.body) {
    const { classes, schemas } = exportedKinds({ statement, local });

    classCount += classes.length;

    if (classPolicy === 'forbidden') {
      for (const { node, name } of classes) {
        context.report({ node, messageId: 'classInHelper', data: { name, kind } });
      }
    }

    // A types or constants file has its own rule for exported values.
    if (schemaPolicy !== 'allowed' && ['code', 'prompt'].includes(exportPolicy)) {
      for (const { node, name } of schemas) {
        context.report({ node, messageId: 'schemaOutsideValidator', data: { name, kind } });
      }
    }
  }

  if (classPolicy === 'required' && classCount === 0) {
    context.report({ node: program, messageId: 'serviceWithoutClass', data: { kind } });
  }
}

function checkPromptShape(params) {
  const { context, program } = params;
  const bindings = promptBindings(program);
  const local = classesAndSchemas(program);

  for (const statement of program.body) {
    for (const { node, value, name } of promptExports(statement)) {
      const localName = value?.type === 'Identifier' ? value.name : name;

      if (local.classes.has(localName) || local.schemas.has(localName)) continue;
      if (isPromptValue({ node: value, bindings })) continue;

      context.report({ node, messageId: 'invalidPromptExport', data: { name } });
    }

    if (statement.declaration?.type === 'TSEnumDeclaration') {
      context.report({
        node: statement.declaration,
        messageId: 'invalidPromptExport',
        data: { name: statement.declaration.id.name },
      });
    }
  }
}

/** What a file may export follows from its kind's `exports` policy. */
export const kindContents = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      invalidPromptExport:
        'A `*.prompt.ts` exports only text fragments, structured string prompt data or synchronous rendering functions with typed parameters and an explicit prompt return type. Move `{{name}}` to its owning types/constants/code file if it is not prompt content.',
      promptDefinition:
        'A `*.prompt.ts` holds no {{definition}} definitions, exported or private. Keep classes in their code kind and schemas/validation in a `*.validator.ts`; prompts only author text/data and render it.',
      valueInTypes:
        "`*.types.ts` holds only types. Move `{{name}}` to the module's constants file if it is a literal, else to its utils, helper or service file.",
      valueImportInTypes:
        '`*.types.ts` holds only types, so it imports only types: write `import type { … }` (for a schema, `import type { xSchema }` and `z.infer<typeof xSchema>`).',
      typeInConstants:
        "`*.constants.ts` holds only literal values. Move type `{{name}}` to the module's `*.types.ts`.",
      codeInConstants:
        "`*.constants.ts` holds only literal values; `{{name}}` is computed or a function. Move it to the module's utils, helper or service file.",
      typeInCode:
        "Export types from the module's `*.types.ts`, not from a {{kind}} file. Move `{{name}}` there and import it with `import type`; a type only this file uses can stay unexported.",
      literalInCode:
        "Export literal constants from the module's `*.constants.ts`, not from a {{kind}} file. Move `{{name}}` there.",
      literalConstantInCode:
        "A `*.{{kind}}.ts` keeps no literal constants, exported or not. Move `{{name}}` to the module's `*.constants.ts` and import it.",
      classInHelper:
        'A `*.{{kind}}.ts` holds stateless functions, so it exports no class. `{{name}}` owns state: move it to a `*.service.ts`.',
      serviceWithoutClass:
        'A `*.{{kind}}.ts` owns state, so it exports a class. With functions only, rename it `*.helper.ts` (it does I/O or calls services) or `*.utils.ts` (it is pure).',
      schemaOutsideValidator:
        "Export zod schemas from the module's `*.validator.ts`, not from a {{kind}} file, so one file shows what a module accepts. Move `{{name}}` there; a schema only this file uses can stay unexported.",
    },
  },
  create(context) {
    const kind = kindOfFile(context.filename);

    if (!kind) return {};

    const policy = FILE_KIND_POLICIES[kind].exports;
    let schemaRoots = new Set();
    const reportClass = (node) =>
      context.report({ node, messageId: 'promptDefinition', data: { definition: 'class' } });

    return {
      ...(kind === 'prompt'
        ? {
            ClassDeclaration: reportClass,
            ClassExpression: reportClass,
            VariableDeclarator(node) {
              if (!node.init || !chainRoots(node.init).some((root) => schemaRoots.has(root))) {
                return;
              }

              if (node.id.type === 'Identifier') schemaRoots.add(node.id.name);

              context.report({
                node,
                messageId: 'promptDefinition',
                data: { definition: 'schema' },
              });
            },
          }
        : {}),
      Program(program) {
        if (kind === 'prompt') {
          schemaRoots = new Set([...zodNames(program), ...classesAndSchemas(program).schemas]);
        }

        checkKindShape({ context, program, kind });
        checkPrivateLiterals({ context, program, kind });

        if (policy === 'prompt') checkPromptShape({ context, program });

        for (const statement of program.body) {
          if (policy === 'types' && isValueImport(statement)) {
            context.report({ node: statement, messageId: 'valueImportInTypes' });
          }

          const exports = describeExports({
            statement,
            sourceCode: policy === 'constants' ? context.sourceCode : undefined,
          });

          for (const { node, name, shape } of exports) {
            const messageId = VIOLATIONS[policy][shape];

            if (messageId) context.report({ node, messageId, data: { name, kind } });
          }
        }
      },
    };
  },
};
