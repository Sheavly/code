import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { WorkbookStore } from './store.service.js';
import { WorkbookCheckError } from './check.errors.js';
import { WORKSPACES_DIR } from './workbook.constants.js';

/** Must run before connecting: checks never attach to or reconfigure an existing backend. */
export function assertCheckBackend(env: NodeJS.ProcessEnv): void {
  if (env.BACKEND_URL) {
    throw new WorkbookCheckError({
      message: 'Workbook checks require their own backend; unset BACKEND_URL.',
    });
  }
}

/** Both roots must name the exact workspace prepared by this store, under its generated runs. */
export async function assertCheckWorkspace(params: {
  store: WorkbookStore;
  name: string;
  workspaceRoot: string;
  actualWorkspace: string;
}): Promise<void> {
  const { store, name, workspaceRoot, actualWorkspace } = params;

  try {
    const [root, workspaces, runs, expected, prepared, actual] = await Promise.all([
      realpath(store.root),
      realpath(store.workspacesDir),
      realpath(path.join(store.workspacesDir, 'runs')),
      realpath(store.runWorkspaceDir(name)),
      realpath(workspaceRoot),
      realpath(actualWorkspace),
    ]);

    if (
      workspaces !== path.join(root, WORKSPACES_DIR) ||
      runs !== path.join(workspaces, 'runs') ||
      expected !== path.join(runs, name) ||
      prepared !== expected ||
      actual !== expected
    ) {
      throw new WorkbookCheckError({
        message: 'Check backend workspace does not match the generated check workspace.',
      });
    }
  } catch (caughtError) {
    if (caughtError instanceof WorkbookCheckError) throw caughtError;

    throw new WorkbookCheckError({
      message: 'Could not verify check workspace isolation.',
      cause: caughtError,
    });
  }
}
