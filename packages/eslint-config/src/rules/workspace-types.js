// Reads which file defines each type, from the workspaces on disk: every workspace's `src/` (and
// the root's, if it ever has one). Each `*.types.ts` (outside tests and fakes) owns the type
// names it exports. Nothing is listed by hand: the packages come from the root `package.json`
// `workspaces`, their names from their own `package.json`, the types from their source. Files are
// re-read when they change, so a long-running ESLint (an editor) sees new ones too.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';

const TYPES_FILE = /\.types\.ts$/;
/** Test code and fakes aren't contracts: their types never ship. */
const NOT_CONTRACT = /(^|\/)(__tests__|testing)\//;

/** What was read per workspace root, with the file signature it was read at. */
const cache = new Map();

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The workspace root: the nearest `package.json` above `cwd` that lists `workspaces`. */
export function findRoot(cwd) {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');

    if (existsSync(manifest) && Array.isArray(readJson(manifest).workspaces)) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

/** The root (while it has `src/`) and every directory the root `workspaces` patterns (`packages/*`, `tools/cli`) match that holds a `package.json`. */
export function workspaceDirs(root) {
  const packageDirs = readJson(path.join(root, 'package.json')).workspaces.flatMap((pattern) => {
    if (!pattern.endsWith('/*')) return [path.join(root, pattern)];

    const parent = path.join(root, pattern.slice(0, -2));

    // A pattern for a folder nobody created yet (`apps/*` before the first app) matches nothing.
    if (!existsSync(parent)) return [];

    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name));
  });

  // The root is a workspace only while it holds source of its own (`src/`); otherwise it is just
  // the monorepo around the workspaces.
  const rootDirs = existsSync(path.join(root, 'src')) ? [root] : [];

  return [...rootDirs, ...packageDirs].filter((dir) => existsSync(path.join(dir, 'package.json')));
}

/** The workspaces with a `src/`: their directory, source, name and scripts. */
function workspaces(root) {
  return workspaceDirs(root)
    .filter((dir) => existsSync(path.join(dir, 'src')))
    .map((dir) => {
      const manifest = readJson(path.join(dir, 'package.json'));

      return {
        dir,
        src: path.join(dir, 'src'),
        name: manifest.name,
        scripts: manifest.scripts ?? {},
      };
    });
}

function typesFiles(workspace) {
  return readdirSync(workspace.src, { recursive: true })
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => TYPES_FILE.test(entry) && !NOT_CONTRACT.test(entry))
    .sort()
    .map((entry) => path.join(workspace.src, entry));
}

/** The names a file exports as types, declared in it (`export type X`, `type X; export { X }`). */
export function exportedTypeNames(code) {
  const { ast } = tseslint.parser.parseForESLint(code, { range: false, loc: false });
  const declared = new Set(
    ast.body
      .map((statement) =>
        statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement,
      )
      .filter(
        (node) =>
          node?.type === 'TSTypeAliasDeclaration' || node?.type === 'TSInterfaceDeclaration',
      )
      .map((node) => node.id.name),
  );

  return ast.body.flatMap((statement) => {
    if (statement.type !== 'ExportNamedDeclaration' || statement.source) return [];
    if (statement.declaration?.id) return [statement.declaration.id.name];

    return statement.specifiers
      .filter((specifier) => declared.has(specifier.local.name))
      .map((specifier) => specifier.exported.name);
  });
}

/**
 * Every owned type name, with the files that export it (one, unless a file copies another), and
 * the workspaces. Re-read only when a workspace or a types file was added, removed or changed.
 */
export function readWorkspace(root) {
  const found = workspaces(root);
  const files = found.flatMap((workspace) =>
    typesFiles(workspace).map((file) => ({ workspace, file })),
  );
  const signature = files.map(({ file }) => `${file}:${String(statSync(file).mtimeMs)}`).join('|');
  const cached = cache.get(root);

  if (cached?.signature === signature) return cached.read;

  const owners = new Map();

  for (const { workspace, file } of files) {
    for (const name of exportedTypeNames(readFileSync(file, 'utf8'))) {
      owners.set(name, [...(owners.get(name) ?? []), { workspace, file }]);
    }
  }

  const read = { workspaces: found, owners };

  cache.set(root, { signature, read });

  return read;
}

/**
 * The source file an import specifier names: a relative path (`./x.types.js`) or a workspace
 * package's subpath (`@sheavly/protocol/event/event.types`). Undefined for anything else.
 */
export function resolveSource(params) {
  const { workspaces: found, from, specifier } = params;

  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(from), specifier).replace(/\.js$/, '.ts');
  }

  const owner = found.find((workspace) => specifier.startsWith(`${workspace.name}/`));

  return owner && path.join(owner.src, `${specifier.slice(owner.name.length + 1)}.ts`);
}

/** How `from` imports `owner.file`: a relative `.js` path in its own workspace, else the subpath. */
function importPath(params) {
  const { from, owner } = params;
  const subpath = path.relative(owner.workspace.src, owner.file).split(path.sep).join('/');

  if (from.startsWith(`${owner.workspace.src}${path.sep}`)) {
    const relative = path.relative(path.dirname(from), owner.file).split(path.sep).join('/');

    return `${relative.startsWith('.') ? '' : './'}${relative.replace(/\.ts$/, '.js')}`;
  }

  return `${owner.workspace.name}/${subpath.replace(/\.ts$/, '')}`;
}

/** What to tell someone who copied `owner`'s type: where it is defined and how to change it. */
export function describeOwner(params) {
  const { from, owner } = params;
  const validator = owner.file.replace(TYPES_FILE, '.validator.ts');
  const shown = path.relative(owner.workspace.dir, owner.file).split(path.sep).join('/');
  const regenerate = owner.workspace.scripts.schema
    ? `, then \`npm run schema -w ${owner.workspace.name}\``
    : '';

  return {
    owner: `${owner.workspace.name}'s \`${shown}\``,
    source: importPath({ from, owner }),
    change: existsSync(validator)
      ? `it is \`z.infer\` of a schema, so change the schema in \`${shown.replace(TYPES_FILE, '.validator.ts')}\`${regenerate}`
      : `change it in \`${shown}\``,
  };
}
