// The types the run services carry, read from the file that defines them, so a rule can't drift
// from the services: every `export const KEY = defineService<Type>('name')` in the extension
// package's run-services file maps `Type` to `KEY`. Primitives (`string`) are services too, but a
// primitive is never a registry, so only named types are kept.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';

/** Where the run-service keys are defined, from the repo root: the extension package holds them. */
export const RUN_SERVICES_FILE = 'packages/extension/src/run-services/run-services.utils.ts';

/** Where the output types are defined, from the repo root: `OutputStore` bundles two services. */
export const CORE_OUTPUT_FILE = 'packages/core/src/output/output.types.ts';

/** What was read per file, with the modification time it was read at. */
const cache = new Map();

/** The type argument of a `defineService<T>(…)` call, or undefined for any other expression. */
function serviceTypeOf(init) {
  if (init?.type !== 'CallExpression') return undefined;
  if (init.callee.type !== 'Identifier' || init.callee.name !== 'defineService') return undefined;

  const argument = (init.typeArguments ?? init.typeParameters)?.params[0];

  return argument?.type === 'TSTypeReference' && argument.typeName.type === 'Identifier'
    ? argument.typeName.name
    : undefined;
}

/** The name string of a `defineService<T>('name')` call, or undefined when it is not a literal. */
function serviceNameOf(init) {
  const [name] = init.arguments;

  return name?.type === 'Literal' && typeof name.value === 'string' ? name.value : undefined;
}

/**
 * Every `export const KEY = defineService<Type>('name')` of `ast` with a named type and a literal
 * name, as a map from the constant to `{ name, type }`.
 */
function serviceKeysIn(ast) {
  const keys = new Map();

  for (const statement of ast.body) {
    if (statement.type !== 'ExportNamedDeclaration') continue;

    for (const declarator of statement.declaration?.declarations ?? []) {
      const type = serviceTypeOf(declarator.init);
      const name = type ? serviceNameOf(declarator.init) : undefined;

      if (type && name !== undefined && declarator.id.type === 'Identifier') {
        keys.set(declarator.id.name, { name, type });
      }
    }
  }

  return keys;
}

/** The service types of `keys`, as a map from type name to its key constants joined with ` or `. */
function serviceTypesOf(keys) {
  const byType = new Map();

  for (const [key, { type }] of keys) byType.set(type, [...(byType.get(type) ?? []), key]);

  return new Map([...byType].map(([type, names]) => [type, names.join(' or ')]));
}

/** Parses `code`, or returns undefined for a syntax error (the host's own checks report those). */
export function parseSource(code) {
  try {
    // No project is read, but the parser still infers a root from every config it has seen, and
    // fails when a linted repo has several: a fixed one keeps this read independent of that.
    const parserOptions = { range: false, loc: false, tsconfigRootDir: import.meta.dirname };

    return tseslint.parser.parseForESLint(code, parserOptions).ast;
  } catch (caughtError) {
    // Only a syntax error (it carries a position) is expected; anything else is a real failure.
    if (caughtError instanceof Error && 'lineNumber' in caughtError) return undefined;

    throw caughtError;
  }
}

/** The member names of `type` when it is an intersection of plain type references, else undefined. */
function intersectionMembers(type) {
  if (type.type !== 'TSIntersectionType') return undefined;

  const names = type.types.map((member) =>
    member.type === 'TSTypeReference' && member.typeName.type === 'Identifier'
      ? member.typeName.name
      : undefined,
  );

  return names.every((name) => name !== undefined) ? names : undefined;
}

/**
 * Adds to `types` every exported `type X = A & B` of `ast` whose members are all service types,
 * mapped to the members' keys joined with ` and `: a whole that bundles services (the output
 * store is its reader and its capture) is as much run state as its parts. In file order, so a
 * composite may build on an earlier one; a name `types` already has is kept.
 */
function addCompositesIn(params) {
  const { ast, types } = params;

  for (const statement of ast.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : null;

    if (declaration?.type !== 'TSTypeAliasDeclaration') continue;

    const members = intersectionMembers(declaration.typeAnnotation);

    if (members?.every((name) => types.has(name)) && !types.has(declaration.id.name)) {
      types.set(declaration.id.name, members.map((name) => types.get(name)).join(' and '));
    }
  }
}

function readOnce(params) {
  const { file, coreFile } = params;
  const ast = parseSource(readFileSync(file, 'utf8'));

  if (!ast) return { state: 'unparsable', types: new Map(), keys: new Map() };

  const keys = serviceKeysIn(ast);
  const types = serviceTypesOf(keys);
  // A missing or unparsable core file only means no composites: the run-services file stays the
  // source of truth for whether the rule can see anything.
  const coreAst = coreFile ? parseSource(readFileSync(coreFile, 'utf8')) : undefined;

  if (coreAst) addCompositesIn({ ast: coreAst, types });

  return { state: 'read', types, keys };
}

/** The path of `file` when it is a regular file, with its modification time. */
function regularFile(file) {
  const info = statSync(file, { throwIfNoEntry: false });

  return info?.isFile() ? { file, mtimeMs: info.mtimeMs } : undefined;
}

/**
 * What the run-services file under `root` yields: `state` is `missing` (a throwaway tree, a
 * checkout without the host), `unparsable` (a syntax error) or `read`, and `types` maps each
 * type name to its key constants joined with ` or `, empty unless `read`, and `keys` maps each
 * key constant to its service `name` and carried `type`, empty unless `read`. `types` also holds each
 * exported intersection of service types in `CORE_OUTPUT_FILE` (`OutputStore`), mapped to its
 * members' keys joined with ` and `; that file being missing or unparsable adds nothing and is no
 * error. Re-read when either file changes, a failed parse included, so a broken file is not
 * parsed once per linted file.
 */
export function readRunServices(root) {
  const file = path.join(root, RUN_SERVICES_FILE);
  // A directory or another special file at that path is a broken checkout, not a file to read.
  const services = regularFile(file);

  if (!services) return { state: 'missing', types: new Map(), keys: new Map() };

  const core = regularFile(path.join(root, CORE_OUTPUT_FILE));
  const signature = `${services.mtimeMs}:${core?.mtimeMs}`;
  const cached = cache.get(file);

  if (cached?.signature === signature) return cached.result;

  const result = readOnce({ file, coreFile: core?.file });

  cache.set(file, { signature, result });

  return result;
}

/** The service types of the run-services file under `root`: empty when missing or unparsable. */
export function readRunServiceTypes(root) {
  return readRunServices(root).types;
}
