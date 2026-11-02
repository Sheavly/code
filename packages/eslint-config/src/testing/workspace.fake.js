// Test-only: throwaway workspaces on disk for the rules that read the repo (layout, imports).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Writes `files` (path relative to `root` → string, or JSON for anything else) under `root`. */
export function writeFiles(params) {
  const { root, files } = params;

  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(
      path.join(root, file),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
}

/** A new temp directory holding `files`; returns its path. */
export function tempWorkspace(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'harness-workspace-'));

  writeFiles({ root, files });

  return root;
}
