import path from 'node:path';

/**
 * True when the last part of `file` names a `.env*` file (`.env`, `.env.local`, case-insensitive,
 * trailing dots and spaces ignored as Windows does): secrets that must never reach the model.
 */
export function isEnvName(file: string): boolean {
  return /^\.env(\..*)?$/i.test(path.basename(file).replace(/[. ]+$/, ''));
}

/**
 * True if `target` is `folder` or inside it, by path alone (resolve real paths first to follow
 * symlinks). A name that only starts with dots, like `..x/`, is inside; `..` and `../x` aren't.
 */
export function isInside(params: { folder: string; target: string }): boolean {
  const relative = path.relative(params.folder, params.target);

  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
