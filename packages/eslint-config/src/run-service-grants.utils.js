// Which grant each method of each scoped run service needs, read from the file that declares it
// (`RUN_SERVICE_GRANTS`) so a rule can't drift from the services: the file is parsed, never
// executed, and is a plain literal (nested object literals, string literals, plain or quoted
// names, optionally `as const`). A file of another shape yields nothing rather than a guess, and
// the rule reports that instead of going silent.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseSource } from './run-service-types.utils.js';

/** Where the mapping is declared, from the repo root: the extension package holds it. */
export const RUN_SERVICE_GRANTS_FILE =
  'packages/extension/src/run-services/run-service-grants.constants.ts';

const TABLE_NAME = 'RUN_SERVICE_GRANTS';

/** What was read per file, with the modification time and size it was read at. */
const cache = new Map();

/** The name of a non-computed property of an object literal, or undefined for any other. */
export function staticKey(property) {
  if (property.type !== 'Property' || property.computed || property.kind !== 'init') {
    return undefined;
  }

  const { key } = property;

  if (key.type === 'Identifier') return key.name;

  return key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
}

const isStringLiteral = (node) => node.type === 'Literal' && typeof node.value === 'string';

/** `{ name: 'value', … }` as a map; undefined when a property is not a plain string entry. */
function stringMap(object) {
  if (object.type !== 'ObjectExpression') return undefined;

  const entries = object.properties.map((property) => {
    const key = staticKey(property);

    return key !== undefined && isStringLiteral(property.value)
      ? [key, property.value.value]
      : undefined;
  });

  return entries.includes(undefined) ? undefined : new Map(entries);
}

/** The property of `object` named `name`, if it is written as a plain property. */
function propertyNamed(params) {
  const { object, name } = params;

  return object.properties.find((property) => staticKey(property) === name);
}

/** A grant string, or `{ grant, arguments }`, as `{ grant, arguments: Map }`; else undefined. */
function entryOf(node) {
  if (isStringLiteral(node)) return { grant: node.value, arguments: new Map() };

  if (node.type !== 'ObjectExpression' || node.properties.length !== 2) return undefined;

  const grant = propertyNamed({ object: node, name: 'grant' })?.value;
  const grants = propertyNamed({ object: node, name: 'arguments' })?.value;
  const byArgument = grants ? stringMap(grants) : undefined;

  return grant && isStringLiteral(grant) && byArgument
    ? { grant: grant.value, arguments: byArgument }
    : undefined;
}

/** `{ member: entry, … }` as a map; undefined when any member is not a valid entry. */
function membersOf(object) {
  if (object.type !== 'ObjectExpression') return undefined;

  const members = object.properties.map((property) => {
    const key = staticKey(property);
    const entry = key === undefined ? undefined : entryOf(property.value);

    return entry ? [key, entry] : undefined;
  });

  return members.includes(undefined) ? undefined : new Map(members);
}

/** The object literal `expression` is, looking through `as const` / `satisfies`. */
function literalOf(expression) {
  let current = expression;

  while (current?.type === 'TSAsExpression' || current?.type === 'TSSatisfiesExpression') {
    current = current.expression;
  }

  return current?.type === 'ObjectExpression' ? current : undefined;
}

/** The initialiser of the exported `RUN_SERVICE_GRANTS` constant in `ast`. */
function tableIn(ast) {
  for (const statement of ast.body) {
    for (const declarator of statement.declaration?.declarations ?? []) {
      if (declarator.id.type === 'Identifier' && declarator.id.name === TABLE_NAME) {
        return literalOf(declarator.init);
      }
    }
  }

  return undefined;
}

/** The mapping in `ast`, or an empty one when the table is missing or has another shape. */
function readTable(ast) {
  const table = tableIn(ast);
  const services = table?.properties.map((property) => {
    const key = staticKey(property);
    const members = key === undefined ? undefined : membersOf(property.value);

    return members ? [key, members] : undefined;
  });

  return !services || services.includes(undefined) ? new Map() : new Map(services);
}

/**
 * What the mapping file under `root` yields: `state` is `missing` (not a regular file: a
 * throwaway tree, a checkout without the extension package), `unparsable` (a syntax error, for the
 * compiler to report) or `read`, and `grants` maps service name to member name to
 * `{ grant, arguments }`, where `arguments` maps an argument property to the grant it needs. A
 * `read` state with an empty `grants` is a file that parses but is not the documented literal
 * (all or nothing: one entry the reader cannot read empties the whole table). Re-read when the
 * file's modification time or size changes, a failed parse included, so a broken file is not
 * parsed once per linted file.
 */
export function readRunServiceGrants(root) {
  const file = path.join(root, RUN_SERVICE_GRANTS_FILE);
  const info = statSync(file, { throwIfNoEntry: false });

  if (!info?.isFile()) return { state: 'missing', grants: new Map() };

  // The size too: an edit within one modification tick must not read as stale.
  const signature = `${info.mtimeMs}:${info.size}`;
  const cached = cache.get(file);

  if (cached?.signature === signature) return cached.result;

  const ast = parseSource(readFileSync(file, 'utf8'));
  const result = ast
    ? { state: 'read', grants: readTable(ast) }
    : { state: 'unparsable', grants: new Map() };

  cache.set(file, { signature, result });

  return result;
}
