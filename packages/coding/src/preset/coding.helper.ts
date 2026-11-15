import { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';
import { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import { ProcessRunner } from '@sheavly/workspace/process/process.service';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { createHarness } from '@sheavly/host/host/host.helper';
import { composeInstructions } from '@sheavly/host/instructions/instructions.helper';
import { CODING_INSTRUCTIONS } from '../instructions/coding-instructions.prompt.js';
import type { CodingHarness, CodingHarnessOptions } from './coding.types.js';

/**
 * The coding services on `createHarness`: opens the workspace and makes the one set of file locks
 * and the one process runner a run shares. It adds no tools and no hooks; the UI composes them on
 * these (`createReadFileTool({ workspace })`, `createRunCommandTool({ processes, … })`,
 * `createAgentsMdHook`, `loadProjectHooks`), so what a run includes is the UI's choice.
 */
export async function createCodingHarness(options: CodingHarnessOptions): Promise<CodingHarness> {
  const {
    workspaceRoot,
    scratchRoot,
    env,
    fileLocks = new FileLocks(),
    ...harnessOptions
  } = options;
  const workspace = await Workspace.open(workspaceRoot, { scratchRoot, env });
  const harness = createHarness({
    ...harnessOptions,
    instructions: composeInstructions({
      baseInstructions: CODING_INSTRUCTIONS,
      instructions: harnessOptions.instructions,
    }),
  });
  const fileReads = new FileReads();

  // A released session is forgotten for good, so what it was shown of the files goes with it, for
  // every front end that builds its run on this harness.
  harness.sessions.subscribe((update) => {
    if (update.type === 'session_released') fileReads.forgetAgent({ agent: update.session.id });
  });

  return {
    ...harness,
    workspace,
    fileLocks,
    fileReads,
    processes: new ProcessRunner({ env }),
  };
}
