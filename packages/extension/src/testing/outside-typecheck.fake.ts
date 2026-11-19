import path from 'node:path';
import ts from 'typescript';
import { repoRoot } from './outside-workspace.fake.js';

/** The repo's own compiler options, so the fixture is held to the strictness the packages are. */
function repoCompilerOptions(): ts.CompilerOptions {
  const root = repoRoot();
  const file = path.join(root, 'tsconfig.base.json');
  const read: { config?: unknown; error?: ts.Diagnostic } = ts.readConfigFile(file, (name) =>
    ts.sys.readFile(name),
  );

  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  }

  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);

  return {
    ...parsed.options,
    noEmit: true,
    // `types: ["node"]` is looked up from the workspace, which has no `@types` of its own.
    typeRoots: [path.join(root, 'node_modules', '@types')],
  };
}

/**
 * What the TypeScript compiler reports for the workspace at `dir` whose entry is `entry`, one
 * line per diagnostic, under the repo's own options (`nodenext` resolution, the `@sheavly/source`
 * condition, every strict flag). An empty list means every import resolved through a package's
 * `exports` map and everything type-checks.
 */
export function typeCheckOutside(params: { dir: string; entry: string }): string[] {
  const { dir, entry } = params;
  const options = repoCompilerOptions();
  const program = ts.createProgram({ rootNames: [entry], options });

  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const where =
      diagnostic.file === undefined ? '' : `${path.relative(dir, diagnostic.file.fileName)}: `;

    return `${where}TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
}

/** Every module specifier `source` imports (static, type-only, dynamic and `require`). */
export function importSpecifiers(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((imported) => imported.fileName);
}
