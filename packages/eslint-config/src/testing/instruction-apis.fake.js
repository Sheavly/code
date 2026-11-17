// Test-only: reads the source of the packages at a root for the exported functions that take
// model instructions, so a test can hold `OPTION_APIS` (`rules/prompt-apis.utils.js`) to the code.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import { isExported } from '../exports.utils.js';
import { readLayout } from '../layout.utils.js';
import { isTestOrFake } from '../test-paths.utils.js';

const INSTRUCTION_OPTIONS = new Set(['instructions', 'baseInstructions']);

function parse(file) {
  return tseslint.parser.parseForESLint(readFileSync(file, 'utf8'), {}).ast;
}

function hasInstructionOption(members) {
  return members.some(
    (member) => member.type === 'TSPropertySignature' && INSTRUCTION_OPTIONS.has(member.key?.name),
  );
}

function declarationsOf(ast) {
  return ast.body.map((statement) =>
    statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement,
  );
}

/** Whether `type` is, or is built from, a type with an `instructions` option. */
function carriesInstructions(params) {
  const { type, names } = params;

  if (!type) return false;

  if (type.type === 'TSTypeLiteral') return hasInstructionOption(type.members);

  if (type.type === 'TSTypeReference') {
    return (
      names.has(type.typeName.name) ||
      (type.typeArguments?.params ?? []).some((inner) =>
        carriesInstructions({ type: inner, names }),
      )
    );
  }

  return (type.types ?? []).some((inner) => carriesInstructions({ type: inner, names }));
}

/**
 * The names of the types in `asts` that carry an `instructions` option: their own, through an
 * interface's `extends`, or through an alias built from one (`Base & { … }`). Found by passes, as a
 * type can be declared before the one it builds on.
 */
function instructionTypeNames(asts) {
  const declarations = asts
    .flatMap(declarationsOf)
    .filter((entry) => ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'].includes(entry?.type));
  const names = new Set();
  const carries = (declaration) => {
    if (declaration.type === 'TSTypeAliasDeclaration') {
      return carriesInstructions({ type: declaration.typeAnnotation, names });
    }

    return (
      hasInstructionOption(declaration.body.body) ||
      declaration.extends.some((parent) => names.has(parent.expression.name))
    );
  };

  for (let grew = true; grew;) {
    grew = false;

    for (const declaration of declarations) {
      if (names.has(declaration.id.name) || !carries(declaration)) continue;
      names.add(declaration.id.name);
      grew = true;
    }
  }

  return names;
}

/** The functions `ast` exports, as `{ name, params }`. */
function exportedFunctions(ast) {
  return ast.body.flatMap((statement) => {
    const declaration = statement.type === 'ExportNamedDeclaration' && statement.declaration;

    if (declaration?.type === 'FunctionDeclaration') {
      return [{ name: declaration.id.name, params: declaration.params }];
    }

    if (declaration?.type !== 'VariableDeclaration') return [];

    return declaration.declarations
      .filter((entry) => /Function/.test(entry.init?.type ?? ''))
      .map((entry) => ({ name: entry.id.name, params: entry.init.params }));
  });
}

/**
 * The source files of every package at `root`, each with whether its package exports it. Tests and
 * fakes are judged by their path below `src/`, not the checkout's: it may sit in a `testing/` folder.
 */
function sourceFiles(root) {
  return Object.values(readLayout({ root }))
    .filter((entry) => entry.kind !== 'app' && entry.exports)
    .flatMap((entry) =>
      entry.modules.flatMap(({ name, files }) =>
        files.map((file) => ({
          inSrc: `${name}/${file}.ts`,
          path: path.join(root, entry.dir, 'src', name, `${file}.ts`),
          isPublic: isExported({ exports: entry.exports, subpath: `${name}/${file}` }),
        })),
      ),
    )
    .filter(({ inSrc }) => !isTestOrFake(inSrc));
}

/**
 * The exported functions of the public modules of the packages at `root` that take an options
 * object with an `instructions` or `baseInstructions` property, by name: what `OPTION_APIS` lists.
 * The options' types are read from every source file, as a package keeps them in a module it
 * does not export.
 */
export function findInstructionApis(root) {
  const files = sourceFiles(root).map((file) => ({ ...file, ast: parse(file.path) }));
  const names = instructionTypeNames(files.map(({ ast }) => ast));

  return [
    ...new Set(
      files
        .filter(({ isPublic }) => isPublic)
        .flatMap(({ ast }) =>
          exportedFunctions(ast)
            .filter(({ params }) =>
              params.some((param) =>
                carriesInstructions({
                  type: (param.left ?? param).typeAnnotation?.typeAnnotation,
                  names,
                }),
              ),
            )
            .map(({ name }) => name),
        ),
    ),
  ].sort();
}
