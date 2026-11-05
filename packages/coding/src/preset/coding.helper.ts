import { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';
import { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import { ProcessRunner } from '@sheavly/workspace/process/process.service';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { createHarness } from '@sheavly/host/host/host.helper';
import type { CodingHarness, CodingHarnessOptions } from './coding.types.js';

/**
 * The coding services on `createHarness`: opens the workspace and makes the one set of file locks
 * and the one process runner a run shares. It adds no tools and no hooks; the UI composes them on
 * these (`createReadFileTool({ workspace })`, `createRunCommandTool({ processes, … })`,
 * `createAgentsMdHook`, `loadProjectHooks`), so what a run includes is the UI's choice.
 */
export async function createCodingHarness(options: CodingHarnessOptions): Promise<CodingHarness> {
  const { workspaceRoot, env, fileLocks = new FileLocks(), ...harnessOptions } = options;
  const workspace = await Workspace.open(workspaceRoot);

  return {
    ...createHarness(harnessOptions),
    workspace,
    fileLocks,
    fileReads: new FileReads(),
    processes: new ProcessRunner({ env }),
  };
}
