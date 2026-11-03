import path from 'node:path';

/**
 * True if `target` is `folder` or inside it, by path alone (resolve real paths first to follow
 * symlinks). A name that only starts with dots, like `..x/`, is inside; `..` and `../x` aren't.
 */
export function isInside(params: { folder: string; target: string }): boolean {
  const relative = path.relative(params.folder, params.target);

  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
