import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { Workspace } from '../runtime/workspace/workspace.service.js';
import type { TempWorkspace } from './testing.types.js';

async function writeFiles(params: { dir: string; files: Record<string, string> }) {
  const { dir, files } = params;

  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), content);
  }
}

/**
 * A temporary Workspace for a test file, removed afterwards. `base/` holds the `outside` files
 * (beyond the workspace's reach, for escape tests); `base/workspace/` holds `files` and is the
 * workspace root. Shared by the file's tests, or fresh for each one with `perTest`.
 */
export function useTempWorkspace(params: {
  prefix: string;
  perTest?: boolean;
  files?: Record<string, string>;
  outside?: Record<string, string>;
}): TempWorkspace {
  const { prefix, perTest = false, files = {}, outside = {} } = params;
  let opened: { base: string; root: string; workspace: Workspace } | undefined;

  const open = async () => {
    const base = await mkdtemp(path.join(tmpdir(), prefix));
    const root = path.join(base, 'workspace');

    await mkdir(root);
    await writeFiles({ dir: base, files: outside });
    await writeFiles({ dir: root, files });
    opened = { base, root, workspace: await Workspace.open(root) };
  };
  const remove = async () => {
    if (opened) await rm(opened.base, { recursive: true, force: true });
    opened = undefined;
  };
  const current = () => {
    if (!opened) throw new Error('useTempWorkspace is only open while its tests run');

    return opened;
  };

  (perTest ? beforeEach : beforeAll)(open);
  (perTest ? afterEach : afterAll)(remove);

  return {
    get base() {
      return current().base;
    },
    get root() {
      return current().root;
    },
    get workspace() {
      return current().workspace;
    },
  };
}
