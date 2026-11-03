// Adds a module to a package's public API: `npm run export -- @sheavly/<name>/<module>/<file>`.
// It checks the file exists, then writes the one `exports` entry through `npm pkg set` (never by
// hand), with the source, types and build targets every entry has. The layout check holds every
// entry to that shape, and `harness/imports` refuses an import of anything not listed.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWorkspaces } from '../packages/eslint-config/src/layout.utils.js';

/** The `npm pkg set` arguments that export `specifier`, or the problem that stops it. */
export function exportCommand(params) {
  const { root, specifier } = params;
  const workspace = listWorkspaces(root).find(({ name }) => specifier.startsWith(`${name}/`));

  if (!workspace || !workspace.relative.startsWith('packages/')) {
    return { problem: `${specifier} names no package: use @sheavly/<package>/<module>/<file>.` };
  }

  const file = specifier.slice(workspace.name.length + 1);
  const source = `./src/${file}.ts`;

  if (!existsSync(path.join(workspace.dir, source))) {
    return { problem: `${workspace.relative}/src/${file}.ts doesn't exist.` };
  }

  const key = `exports[./${file}]`;

  return {
    args: [
      'pkg',
      'set',
      `${key}[@sheavly/source]=${source}`,
      `${key}.types=./dist/${file}.d.ts`,
      `${key}.default=./dist/${file}.js`,
      '-w',
      workspace.relative,
    ],
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '..');
  const specifiers = process.argv.slice(2);

  if (specifiers.length === 0) {
    console.error('Usage: npm run export -- @sheavly/<package>/<module>/<file> […]');
    process.exit(1);
  }

  for (const specifier of specifiers) {
    const { problem, args } = exportCommand({ root, specifier });

    if (problem) {
      console.error(problem);
      process.exit(1);
    }

    const result = spawnSync('npm', args, { cwd: root, stdio: 'inherit' });

    if (result.status !== 0) process.exit(result.status ?? 1);
    console.log(`Exported ${specifier}.`);
  }
}
