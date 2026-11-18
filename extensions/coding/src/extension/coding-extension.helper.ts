import { SUB_AGENTS } from '@sheavly/agents/agents/agents.utils';
import type {
  Contributions,
  Extension,
  Services,
} from '@sheavly/extension/extension/extension.types';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import { readManifest } from '@sheavly/extension/manifest/manifest.helper';
import { OUTPUT_CAPTURE } from '@sheavly/host/run-services/run-services.utils';
import { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import { keepReadsWithConversation } from '../file-reads/file-reads.helper.js';
import type { SkillRoots } from '../skills/skills.types.js';
import { createInstructionHooks, loadWorkspaceHooks } from './coding-hooks.helper.js';
import { createCommandTools, createFileTools } from './coding-tools.helper.js';
import type { CodingExtensionOptions } from './coding-extension.types.js';
import { CODING_RUN } from './coding-extension.utils.js';

// src/extension/ and dist/extension/ are both two levels below the workspace root.
const manifest = readManifest(new URL('../../sheavly.json', import.meta.url));

/**
 * Coding as an extension: the file tools, `read_skill`, `run_command` and `start_service`, the
 * AGENTS.md, skills, scratch and working-root hooks, and the workspace's `.sheavly/` hooks (if it
 * is trusted). Skills are instructions, like AGENTS.md, so workspace trust doesn't gate them.
 *
 * It depends on `agents` to share its tools and hooks with sub-agents, and provides `CODING_RUN`.
 * It reads `OUTPUT_CAPTURE` (`output:capture`), when the host supplies it, from the run services
 * like any extension; the logs it fills are read back through `read_output`. Its
 * one exception is the `harness`: coding's workspace, locks and processes (and the registries,
 * since `createCodingHarness` is built on `createHarness`) come from the harness it is given, and
 * the `env` option is its own (working-root and home resolution). It does not provide the
 * run-level services (they come from the host); it provides `CODING_RUN`. Keeping the
 * conversation's file reads is stopped when the extension is deactivated, or at once if its
 * activation fails.
 */
export function createCodingExtension(options: CodingExtensionOptions): Extension {
  const { harness, shell, env, onFileReadsProblem } = options;
  let stopKeepingReads: () => void = () => undefined;

  return defineExtension({
    manifest,
    activate: async ({ services }) => {
      const { workspace, fileReads, sessions, mainSession } = harness;
      // One per conversation, over its `shell.json`: the main session and every sub-agent share it.
      const workingRoots = new WorkingRoots({ store: shell, workspace, env });
      const skillRoots = { root: workspace.root, home: options.home };

      stopKeepingReads = await keepReadsWithConversation({
        fileReads,
        sessions,
        agentId: mainSession.id,
        store: shell,
        ...(onFileReadsProblem && { onProblem: onFileReadsProblem }),
      });

      try {
        return await contribute({ options, services, workingRoots, skillRoots });
      } catch (caughtError) {
        // An extension whose `activate` threw is not deactivated: it cleans up after itself.
        stopKeepingReads();
        throw caughtError;
      }
    },
    deactivate: () => stopKeepingReads(),
  });
}

/** The coding extension's tools and hooks, and what it provides and shares; throws if a hook is broken. */
async function contribute(params: {
  options: CodingExtensionOptions;
  services: Services;
  workingRoots: WorkingRoots;
  skillRoots: SkillRoots;
}): Promise<Contributions> {
  const { options, services, workingRoots, skillRoots } = params;
  const { harness, permissions } = options;
  const outputs = services.find(OUTPUT_CAPTURE);
  const instructionHooks = createInstructionHooks({ harness, workingRoots, skillRoots });
  const projectHooks = await loadWorkspaceHooks({ harness, instructionHooks, options });
  const hooks = [...instructionHooks, ...projectHooks.hooks];
  const fileTools = createFileTools({ harness, workingRoots, skillRoots });
  const commandTools = createCommandTools({ harness, workingRoots, permissions, outputs });

  services.provide(CODING_RUN, {
    workingRoots,
    skills: skillRoots,
    projectHooks: projectHooks.hooks,
    projectTrust: projectHooks.trust,
  });
  // Last, once nothing after it can fail: what is shared reaches sub-agents at once and is not
  // taken back, so an extension that then failed would leave its tools with them. Sub-agents
  // get the same hook objects, each running its own `sessionStart`.
  services.get(SUB_AGENTS).share({ tools: fileTools, taskTools: commandTools, hooks });

  return { tools: [...fileTools, ...commandTools], hooks };
}
