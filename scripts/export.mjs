// Makes a file kind of a package public: `npm run export -- packages/<name> <kind>`. Every
// `<module>.<kind>.ts` in it becomes importable as `@sheavly/<name>/<module>/<module>.<kind>`, so a
// new module of that kind needs no entry. It writes the one `exports` entry through `npm pkg set`
// (never by hand), with the source and build targets every entry has. `harness/layout` holds
// every entry to that shape, and `harness/imports` refuses an import of a kind not exported.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILE_KINDS } from '../packages/eslint-config/src/file-kinds.js';
import { kindExportKey, kindExportTarget } from '../packages/eslint-config/src/exports.utils.js';
import { listWorkspaces } from '../packages/eslint-config/src/layout.utils.js';

/** The `npm pkg set` arguments that export `kind` from the package at `dir`, or the problem. */
export function exportCommand(params) {
  const { root, dir, kind } = params;
  const workspace = listWorkspaces(root).find(({ relative }) => relative === dir);

  if (!workspace || !/^(packages|extensions)\//.test(dir)) {
    return {
      problem: `${dir} is no package or extension: use packages/<name> or extensions/<name>.`,
    };
  }

  if (!FILE_KINDS.includes(kind) || kind === 'test' || kind === 'fake') {
    return {
      problem: `${kind} is no kind a package exports: use one of ${FILE_KINDS.filter((k) => k !== 'test' && k !== 'fake').join(', ')} (fakes are exported as ./testing/*).`,
    };
  }

  const key = `exports[${kindExportKey(kind)}]`;

  return {
    args: [
      'pkg',
      'set',
      ...Object.entries(kindExportTarget(kind)).map(
        ([condition, target]) => `${key}[${condition}]=${target}`,
      ),
      '-w',
      dir,
    ],
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '..');
  const [dir, ...kinds] = process.argv.slice(2);

  if (!dir || kinds.length === 0) {
    console.error('Usage: npm run export -- packages/<name> <kind> […]');
    process.exit(1);
  }

  for (const kind of kinds) {
    const { problem, args } = exportCommand({ root, dir, kind });

    if (problem) {
      console.error(problem);
      process.exit(1);
    }

    const result = spawnSync('npm', args, { cwd: root, stdio: 'inherit' });

    if (result.status !== 0) process.exit(result.status ?? 1);
    console.log(`${dir} now exports every *.${kind}.ts.`);
  }
}
