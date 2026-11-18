// The types the host's run services carry, read from the file that defines them, so a rule can't
// drift from the services: every `export const KEY = defineService<Type>('name')` in the host's
// run-services file maps `Type` to `KEY`. Primitives (`string`) are services too, but a primitive
// is never a registry, so only named types are kept.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';

/** Where the host defines its run services, from the repo root. */
export const RUN_SERVICES_FILE = 'packages/host/src/run-services/run-services.utils.ts';

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

/** The service types in `ast`, as a map from type name to its key constants joined with ` or `. */
function serviceTypesIn(ast) {
  const keys = new Map();

  for (const statement of ast.body) {
    if (statement.type !== 'ExportNamedDeclaration') continue;

    for (const declarator of statement.declaration?.declarations ?? []) {
      const type = serviceTypeOf(declarator.init);

      if (type && declarator.id.type === 'Identifier') {
        keys.set(type, [...(keys.get(type) ?? []), declarator.id.name]);
      }
    }
  }

  return new Map([...keys].map(([type, names]) => [type, names.join(' or ')]));
}

/** Parses `code`, or returns undefined for a syntax error (the host's own checks report those). */
function parseSource(code) {
  try {
    return tseslint.parser.parseForESLint(code, { range: false, loc: false }).ast;
  } catch (caughtError) {
    // Only a syntax error (it carries a position) is expected; anything else is a real failure.
    if (caughtError instanceof Error && 'lineNumber' in caughtError) return undefined;

    throw caughtError;
  }
}

function readOnce(file) {
  const ast = parseSource(readFileSync(file, 'utf8'));

  return ast
    ? { state: 'read', types: serviceTypesIn(ast) }
    : { state: 'unparsable', types: new Map() };
}

/**
 * What the run-services file under `root` yields: `state` is `missing` (a throwaway tree, a
 * checkout without the host), `unparsable` (a syntax error) or `read`, and `types` maps each
 * type name to its key constants joined with ` or `, empty unless `read`. Re-read when the file
 * changes, a failed parse included, so a broken file is not parsed once per linted file.
 */
export function readRunServices(root) {
  const file = path.join(root, RUN_SERVICES_FILE);
  // A directory or another special file at that path is a broken checkout, not a file to read.
  const info = statSync(file, { throwIfNoEntry: false });

  if (!info?.isFile()) return { state: 'missing', types: new Map() };

  const signature = info.mtimeMs;
  const cached = cache.get(file);

  if (cached?.signature === signature) return cached.result;

  const result = readOnce(file);

  cache.set(file, { signature, result });

  return result;
}

/** The service types of the run-services file under `root`: empty when missing or unparsable. */
export function readRunServiceTypes(root) {
  return readRunServices(root).types;
}
