import { KeyedLocks } from '@sheavly/runtime/locks/keyed-locks.service';
import type { Services } from '@sheavly/extension/extension/extension.types';
import {
  APPROVALS,
  BACKGROUND_TASKS,
  MAIN_SESSION,
} from '@sheavly/host/run-services/run-services.utils';
import { ProcessRunner } from '@sheavly/process/process/process.service';
import { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import type { CodingExtensionOptions, CodingParts } from './coding-extension.types.js';

/**
 * Opens the workspace and makes the file reads and the process runner this run's tools share, and
 * takes the run services the extension reads (background tasks, approvals, main session). The
 * services are read like any extension reads them: each call is checked against the manifest's
 * grants.
 */
export async function openCodingParts(params: {
  options: Pick<CodingExtensionOptions, 'workspaceRoot' | 'scratchRoot' | 'env' | 'fileLocks'>;
  services: Services;
}): Promise<CodingParts> {
  const { options, services } = params;
  const { workspaceRoot, scratchRoot, env, fileLocks = new KeyedLocks() } = options;

  return {
    workspace: await Workspace.open(workspaceRoot, { scratchRoot, env }),
    fileLocks,
    fileReads: new FileReads(),
    processes: new ProcessRunner({ env }),
    tasks: services.get(BACKGROUND_TASKS),
    approvals: services.get(APPROVALS),
    mainSession: services.get(MAIN_SESSION),
  };
}
