// The registries the host's `Harness` type carries, read from the file that defines it, so a rule
// can't drift from the host: every member of `type Harness = { … }` whose type is imported from a
// `*.service` module (a class holding run state: `SessionRegistry`, `TaskRegistry`,
// `ApprovalRegistry`) maps the type's name to that module. Members typed from a types module
// (`Provider`, `SessionRef`) are not registries and are left out.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseSource } from './run-service-types.utils.js';

/** Where the host defines `Harness`, from the repo root. */
export const HARNESS_TYPES_FILE = 'packages/host/src/host/host.types.ts';

const HARNESS_NAME = 'Harness';
const SERVICE_MODULE = /\.service$/;

/** What was read per file, with the modification time it was read at. */
const cache = new Map();

/** `source` without a script extension, so `x.service.js` and `x.service` are one module. */
export function moduleOf(source) {
  return source.replace(/\.[cm]?[jt]s$/, '');
}

/** The imported name and module of every named import in `ast`, by local name. */
function importsIn(ast) {
  const imports = new Map();

  for (const statement of ast.body) {
    if (statement.type !== 'ImportDeclaration') continue;

    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier') continue;

      imports.set(specifier.local.name, {
        name: specifier.imported.name ?? specifier.imported.value,
        module: moduleOf(statement.source.value),
      });
    }
  }

  return imports;
}

/** The members of the `Harness` alias or interface in `ast`, or none when it is not declared. */
function harnessMembersIn(ast) {
  for (const statement of ast.body) {
    const declaration = statement.declaration ?? statement;

    if (declaration.id?.name !== HARNESS_NAME) continue;
    if (declaration.type === 'TSInterfaceDeclaration') return declaration.body.body;

    if (declaration.type === 'TSTypeAliasDeclaration') {
      return declaration.typeAnnotation.members ?? [];
    }
  }

  return [];
}

function registriesIn(ast) {
  const imports = importsIn(ast);
  const registries = new Map();

  for (const member of harnessMembersIn(ast)) {
    const reference = member.typeAnnotation?.typeAnnotation;

    if (reference?.type !== 'TSTypeReference' || reference.typeName.type !== 'Identifier') {
      continue;
    }

    const imported = imports.get(reference.typeName.name);

    if (imported && SERVICE_MODULE.test(imported.module)) {
      registries.set(imported.name, imported.module);
    }
  }

  return registries;
}

function readOnce(file) {
  const ast = parseSource(readFileSync(file, 'utf8'));

  return ast
    ? { state: 'read', registries: registriesIn(ast) }
    : { state: 'unparsable', registries: new Map() };
}

/**
 * What the host's `Harness` type under `root` yields: `state` is `missing` (a throwaway tree),
 * `unparsable` (a syntax error) or `read`, and `registries` maps each registry type name to its
 * module (`@sheavly/runtime/sessions/sessions.service`), empty unless `read`. A member whose type
 * is not a plain reference to a named import (a union, an inline literal) is not followed. Re-read
 * when the file changes.
 */
export function readHarnessRegistries(root) {
  const file = path.join(root, HARNESS_TYPES_FILE);
  const info = statSync(file, { throwIfNoEntry: false });

  if (!info?.isFile()) return { state: 'missing', registries: new Map() };

  const cached = cache.get(file);

  if (cached?.signature === info.mtimeMs) return cached.result;

  const result = readOnce(file);

  cache.set(file, { signature: info.mtimeMs, result });

  return result;
}
