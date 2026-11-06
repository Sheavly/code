import { createHash } from 'node:crypto';
import path from 'node:path';
import type { PathPlatform } from './config-store.types.js';

/**
 * A workspace's key: the SHA-256 of its real path, as 64 lowercase hex characters, so it can be a
 * folder name on any system (a path holds `:`, `\` and `/`, and passes Windows' 260-character
 * limit). `realPath` must already be resolved (symlinks followed), so two ways to reach one
 * folder are one workspace.
 *
 * On Windows a path is not case-sensitive and has two separators, so `C:\Users\X\Proj`,
 * `c:\users\x\proj\` and `C:/Users/X/Proj` are one folder and one key: they are lowercased,
 * their separators made alike and a trailing one dropped. On other systems the path is kept as
 * it is (a trailing separator dropped), since `/Work/Proj` and `/work/proj` are two folders there
 * (and are one on a case-insensitive macOS volume, which the real path from the system already
 * spells one way). `platform` is the system's unless a test names one.
 */
export function workspaceKey(params: { realPath: string; platform?: PathPlatform }): string {
  const { realPath, platform = process.platform === 'win32' ? 'win32' : 'posix' } = params;

  return createHash('sha256').update(normalized({ realPath, platform })).digest('hex');
}

function normalized(params: { realPath: string; platform: PathPlatform }): string {
  const { realPath, platform } = params;

  if (platform === 'win32') {
    return path.win32
      .normalize(realPath)
      .replace(/[\\/]+$/, '')
      .toLowerCase();
  }

  return path.posix.normalize(realPath).replace(/(?<=.)\/+$/, '');
}
