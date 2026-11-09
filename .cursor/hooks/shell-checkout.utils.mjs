import { realpathSync } from 'node:fs';
import path from 'node:path';
import { isMissingPath } from './hooks.errors.mjs';

function canonicalRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return undefined;

  try {
    return realpathSync(root);
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return undefined;
    throw caughtError;
  }
}

/** Keeps findings in this checkout; missing snapshot roots fail closed, never inferred from cwd. */
export function commandsInCheckout(params) {
  const { commands, projectRoot } = params;
  const current = canonicalRoot(projectRoot);

  return commands.filter((entry) => {
    // Execution cwd is not evidence of which checkout the recorder snapshotted.
    const recorded = canonicalRoot(entry.projectRoot);

    return current === undefined || recorded === undefined || recorded === current;
  });
}
