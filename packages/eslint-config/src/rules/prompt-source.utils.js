import path from 'node:path';
import {
  findPromptReviewRoot,
  inventoryManifest,
  inventoryPath,
  inventoryWorkspaceDirs,
} from './system-prompt-review-confinement.utils.js';

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

function sourceWorkspaces(root) {
  return inventoryWorkspaceDirs(root).flatMap((dir) => {
    const src = path.join(dir, 'src');

    if (!inventoryPath({ root, file: src, skipLinks: true })?.isDirectory()) return [];

    const manifest = inventoryManifest({ root, dir });

    if (!manifest) return [];

    return [
      {
        dir,
        src,
        name: manifest.name,
        scripts: manifest.scripts ?? {},
        testOnly: manifest.sheavly?.testOnly === true,
      },
    ];
  });
}

/** Discover only confined metadata for source tracing, not unrelated type-file contents. */
export function promptSourceContext(context) {
  const root =
    findPromptReviewRoot(path.dirname(path.resolve(context.filename))) ??
    findPromptReviewRoot(context.cwd);

  return { root, workspaces: root ? sourceWorkspaces(root) : [] };
}

/** Unknown data imports stay opaque; supported source paths must be confined and non-symlinked. */
export function promptSourceFile(params) {
  const { root, file } = params;

  if (!root || !file || !SOURCE_FILE.test(file)) return;
  if (file.split(/[\\/]/).some((part) => part.startsWith('.env'))) return;
  if (!inventoryPath({ root, file })?.isFile()) return;

  return file;
}
