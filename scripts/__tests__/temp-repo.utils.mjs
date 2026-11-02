// Throwaway repos for the script tests, with this repo's node_modules linked in so the real
// jscpd and knip run against them.
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFiles } from '../../packages/eslint-config/src/testing/workspace.fake.js';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const roots = [];

/**
 * A temp directory holding `files` (path -> content), removed by `removeTempRepos`. This repo's
 * node_modules is linked in, unless `linkNodeModules` is false: a test that runs npm itself must
 * not let it write through the link into the real node_modules.
 */
export function createTempRepo(files, options = {}) {
  const { linkNodeModules = true } = options;
  const root = mkdtempSync(path.join(os.tmpdir(), 'harness-scripts-'));

  roots.push(root);

  if (linkNodeModules) {
    symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  }

  writeFiles({ root, files });

  return root;
}

export function removeTempRepos() {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}
