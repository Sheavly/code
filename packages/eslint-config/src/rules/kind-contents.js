import { FILE_KIND_POLICIES, kindOfFile } from '../file-kinds.js';

// What a file may export follows from its
// kind's `exports` policy in file-kinds.js. Non-exported values and types may stay next to the
// code that uses them.

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

/** Each export of a statement as `{ node, name, shape }`, shape one of type/literal/code. */
function describeExports(statement) {
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
    shape: declarator.init && isLiteralValue(declarator.init) ? 'literal' : 'code',
  }));
}

const VIOLATIONS = {
  types: { literal: 'valueInTypes', code: 'valueInTypes' },
  constants: { type: 'typeInConstants', code: 'codeInConstants' },
  code: { type: 'typeInCode', literal: 'literalInCode' },
};

function isValueImport(statement) {
  if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') return false;

  return (
    statement.specifiers.length === 0 ||
    statement.specifiers.some((specifier) => specifier.importKind !== 'type')
  );
}

/** What a file may export follows from its kind's `exports` policy. */
export const kindContents = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      valueInTypes:
        "`*.types.ts` holds only types. Move `{{name}}` to the module's constants, utils or service file.",
      valueImportInTypes:
        '`*.types.ts` holds only types, so it imports only types: write `import type { … }` (for a schema, `import type { xSchema }` and `z.infer<typeof xSchema>`).',
      typeInConstants:
        "`*.constants.ts` holds only literal values. Move type `{{name}}` to the module's `*.types.ts`.",
      codeInConstants:
        "`*.constants.ts` holds only literal values; `{{name}}` is computed or a function. Move it to the module's utils or service file.",
      typeInCode:
        "Export types from the module's `*.types.ts`, not from a {{kind}} file. Move `{{name}}` there and import it with `import type`; a type only this file uses can stay unexported.",
      literalInCode:
        "Export literal constants from the module's `*.constants.ts`, not from a {{kind}} file. Move `{{name}}` there; a value only this file uses can stay unexported.",
    },
  },
  create(context) {
    const kind = kindOfFile(context.filename);

    if (!kind) return {};

    const policy = FILE_KIND_POLICIES[kind].exports;

    return {
      Program(program) {
        for (const statement of program.body) {
          if (policy === 'types' && isValueImport(statement)) {
            context.report({ node: statement, messageId: 'valueImportInTypes' });
          }

          for (const { node, name, shape } of describeExports(statement)) {
            const messageId = VIOLATIONS[policy][shape];

            if (messageId) context.report({ node, messageId, data: { name, kind } });
          }
        }
      },
    };
  },
};
