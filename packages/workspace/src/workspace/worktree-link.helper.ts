import path from 'node:path';
import { lstatIfUsable, readTextIfUsable, realPathIfUsable } from './fs-usable.helper.js';
import { parseGitdirFile } from './worktrees.utils.js';

/**
 * Whether the linked worktree at `worktree` (a real path) really belongs to the repo whose git
 * dir is `commonDir`. `git worktree list` takes its paths from `.git/worktrees/<id>/gitdir`,
 * which a hostile repo can forge to point anywhere, so a folder counts only when both ends agree:
 * its `.git` is a regular file naming an admin folder directly under `<commonDir>/worktrees`, and
 * that folder's `gitdir` names the same `.git` file back, without following a link. This proves
 * the two files agree, not that they are authentic: forging both ends takes write access inside
 * `.git`, which the file tools refuse.
 */
async function linksBack(params: { worktree: string; commonDir: string }): Promise<boolean> {
  const { worktree, commonDir } = params;
  const dotGit = path.join(worktree, '.git');
  const content = await readTextIfUsable(dotGit);
  const target = content === undefined ? undefined : parseGitdirFile({ content, dir: worktree });
  const adminDir = target === undefined ? undefined : await realPathIfUsable(target);

  if (adminDir === undefined || path.dirname(adminDir) !== path.join(commonDir, 'worktrees')) {
    return false;
  }

  const backLink = await readTextIfUsable(path.join(adminDir, 'gitdir'));

  if (backLink === undefined) return false;

  // Git may write the back-link relative to the admin folder (`worktree.useRelativePaths`).
  const linked = path.resolve(adminDir, backLink.trim());
  const parent = await realPathIfUsable(path.dirname(linked));

  return parent !== undefined && path.join(parent, path.basename(linked)) === dotGit;
}

/**
 * Whether the listed folder `worktree` (a real path) belongs to the repo whose git dir is
 * `commonDir`. Only the main worktree (`isMain`, the one git lists first) may have a `.git`
 * folder, and it must be the common dir itself; every other worktree must link back to it.
 */
export async function belongsToRepo(params: {
  worktree: string;
  commonDir: string;
  isMain: boolean;
}): Promise<boolean> {
  const { worktree, commonDir, isMain } = params;
  const dotGit = path.join(worktree, '.git');
  const stats = await lstatIfUsable(dotGit);

  if (stats === undefined) return false;

  if (isMain) return stats.isDirectory() && (await realPathIfUsable(dotGit)) === commonDir;

  return stats.isFile() && (await linksBack({ worktree, commonDir }));
}
