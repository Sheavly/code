// Throwaway repos for the script tests, with this repo's node_modules linked in so the real
// jscpd and knip run against them.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const roots = [];

/** A temp directory holding `files` (path -> content), removed by `removeTempRepos`. */
export function createTempRepo(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'harness-scripts-'));

  roots.push(root);
  symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'junction');

  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }

  return root;
}

export function removeTempRepos() {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}
