import type { Hook } from '@sheavly/core/hook/hook.types';
import {
  createInstructionHook,
  registerInstructionHooks,
} from '@sheavly/core/instruction-context/instruction-source.helper';
import { scratchSource } from '@sheavly/workspace/scratch/scratch-hook.helper';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import { agentsMdSource } from '../agents-md/agents-md.helper.js';
import { loadProjectHooks } from '../project-hooks/project-hooks.helper.js';
import type { ProjectHooks } from '../project-hooks/project-hooks.types.js';
import type { CodingHarness } from '../preset/coding.types.js';
import { skillsSource } from '../skills/skills.helper.js';
import type { SkillRoots } from '../skills/skills.types.js';
import { workingRootSource } from '../working-root/working-root-hook.helper.js';
import type { CodingExtensionOptions } from './coding-extension.types.js';

/**
 * AGENTS.md, skills, the scratch folder and the working root, as instruction hooks. Their order is
 * each source's declared `order`, not their place here. The working root is read per turn, so
 * AGENTS.md follows a worktree chosen mid-run. The scratch source is given the main session's id,
 * so sub-agents running this same hook share their root agent's folder.
 */
export function createInstructionHooks(params: {
  harness: CodingHarness;
  workingRoots: WorkingRoots;
  skillRoots: SkillRoots;
}): Hook[] {
  const { harness, workingRoots, skillRoots } = params;
  const { workspace } = harness;

  return registerInstructionHooks([
    createInstructionHook(agentsMdSource({ root: workspace.root, workingRoots })),
    createInstructionHook(skillsSource(skillRoots)),
    ...(workspace.scratchRoot
      ? [createInstructionHook(scratchSource({ workspace, agentId: harness.mainSession.id }))]
      : []),
    createInstructionHook(workingRootSource({ workingRoots })),
  ]);
}

/**
 * The workspace's `.sheavly/` hooks. A broken one, or one named like an instruction hook, stops
 * the run here, with the file and the reason. An untrusted workspace loads none: `trust` says
 * why, for a UI to show.
 */
export function loadWorkspaceHooks(params: {
  harness: CodingHarness;
  instructionHooks: readonly Hook[];
  options: Pick<CodingExtensionOptions, 'trustStore' | 'trustWorkspace'>;
}): Promise<ProjectHooks> {
  const { harness, instructionHooks, options } = params;

  return loadProjectHooks({
    root: harness.workspace.root,
    trust: options.trustStore,
    grant: options.trustWorkspace ?? false,
    hostHooks: instructionHooks,
  });
}
