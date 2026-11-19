import type { OutputCapture } from '@sheavly/extension/run-services/run-services.types';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import { createDeleteFileTool } from '../delete-file/delete-file.tool.js';
import { createEditFileTool } from '../edit-file/edit-file.tool.js';
import { createGlobTool } from '../glob/glob.tool.js';
import { createGrepTool } from '../grep/grep.tool.js';
import { createReadFileTool } from '../read-file/read-file.tool.js';
import { createReadSkillTool } from '../read-skill/read-skill.tool.js';
import { createRunCommandTool } from '../run-command/run-command.tool.js';
import { createStartServiceTool } from '../run-command/start-service.tool.js';
import type { CommandPermissions } from '../run-command/run-command.types.js';
import type { SkillRoots } from '../skills/skills.types.js';
import { createSetWorkingRootTool } from '../working-root/set-working-root.tool.js';
import { createWriteFileTool } from '../write-file/write-file.tool.js';
import type { CodingParts } from './coding-extension.types.js';

/** The tools that read, search and change the project, and set the working root. */
export function createFileTools(params: {
  parts: CodingParts;
  workingRoots: WorkingRoots;
  skillRoots: SkillRoots;
}) {
  const { parts, workingRoots, skillRoots } = params;
  const { workspace, fileLocks, fileReads, processes } = parts;

  return [
    createReadFileTool({ workspace, workingRoots, fileLocks, fileReads }),
    createGlobTool({ workspace, workingRoots, processes }),
    createGrepTool({ workspace, workingRoots, processes }),
    createWriteFileTool({ workspace, workingRoots, fileLocks, fileReads }),
    createEditFileTool({ workspace, workingRoots, fileLocks, fileReads }),
    createDeleteFileTool({ workspace, workingRoots, fileLocks, fileReads }),
    createSetWorkingRootTool({ workingRoots }),
    createReadSkillTool({ roots: skillRoots, fileReads }),
  ];
}

/**
 * The tools that start commands, on the run's background tasks: sub-agents get the same
 * instances, and what a call starts is owned by the session that made it.
 */
export function createCommandTools(params: {
  parts: CodingParts;
  workingRoots: WorkingRoots;
  permissions: CommandPermissions;
  outputs: OutputCapture | undefined;
}) {
  const { parts, workingRoots, permissions, outputs } = params;
  const { workspace, tasks, approvals, processes } = parts;
  const options = { workspace, workingRoots, permissions, tasks, approvals, processes, outputs };

  return [createRunCommandTool(options), createStartServiceTool(options)];
}
