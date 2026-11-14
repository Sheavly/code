/**
 * The file's path from the workspace root (ESLint's `cwd`), `/`-separated, so a path pattern never
 * matches a folder above the project (a checkout inside `~/scripts/`).
 */
export function relativePath(context) {
  const { filename, cwd } = context;
  const relative = filename.startsWith(`${cwd}/`) ? filename.slice(cwd.length + 1) : filename;

  return relative.split('\\').join('/');
}
