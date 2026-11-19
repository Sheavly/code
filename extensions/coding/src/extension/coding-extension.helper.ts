import { SUB_AGENTS } from '@sheavly/agents/agents/agents.utils';
import type {
  Contributions,
  Extension,
  Services,
} from '@sheavly/extension/extension/extension.types';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import { readManifest } from '@sheavly/extension/manifest/manifest.helper';
import { OUTPUT_CAPTURE, SESSION_INFO } from '@sheavly/extension/run-services/run-services.utils';
import { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import {
  forgetReleasedAgents,
  keepReadsWithConversation,
} from '../file-reads/file-reads.helper.js';
import { CODING_INSTRUCTIONS } from '../instructions/coding-instructions.prompt.js';
import type { SkillRoots } from '../skills/skills.types.js';
import { createInstructionHooks, loadWorkspaceHooks } from './coding-hooks.helper.js';
import { CODING_SECTION } from './coding-extension.constants.js';
import { createCommandTools, createFileTools } from './coding-tools.helper.js';
import type { CodingExtensionOptions, CodingParts } from './coding-extension.types.js';
import { CODING_RUN } from './coding-extension.utils.js';
import { openCodingParts } from './coding-parts.helper.js';

// src/extension/ and dist/extension/ are both two levels below the workspace root.
const manifest = readManifest(new URL('../../sheavly.json', import.meta.url));

/**
 * Coding as an extension: the file tools, `read_skill`, `run_command` and `start_service`, the
 * AGENTS.md, skills, scratch and working-root hooks, and the workspace's `.sheavly/` hooks (if it
 * is trusted). Skills are instructions, like AGENTS.md, so workspace trust doesn't gate them.
 *
 * It integrates like any extension, with no access a third party lacks. It opens its own
 * workspace, file reads and process runner (the process runner stops what it started when the
 * process exits) and takes its file locks from the `fileLocks` option, so several runs can share
 * them. It reads `SESSION_INFO` (`session:read`: the main session's idle keeps the file reads, any
 * session's release forgets its reads), `BACKGROUND_TASKS` (`task:start`), `APPROVALS`
 * (`approval:request`, and `approval:as-tool` and `approval:keep` for its two tools' prompts),
 * `MAIN_SESSION`, `SUB_AGENTS` and, when the host supplies it, `OUTPUT_CAPTURE`
 * (`output:capture`; the logs it fills are read back through `read_output`). It depends on
 * `agents` to share its tools and hooks with sub-agents, and provides `CODING_RUN`. Listening to
 * the sessions is stopped when the extension is deactivated, or at once if its activation fails.
 */
export function createCodingExtension(options: CodingExtensionOptions): Extension {
  const { shell, env, onFileReadsProblem } = options;
  let stopListening: () => void = () => undefined;

  return defineExtension({
    manifest,
    activate: async ({ services }) => {
      const parts = await openCodingParts({ options, services });
      const { workspace, fileReads, mainSession } = parts;
      const sessions = services.get(SESSION_INFO);
      // One per conversation, over its `shell.json`: the main session and every sub-agent share it.
      const workingRoots = new WorkingRoots({ store: shell, workspace, env });
      const skillRoots = { root: workspace.root, home: options.home };
      const stopForgetting = forgetReleasedAgents({ fileReads, sessions });
      const stopKeeping = await keepReadsWithConversation({
        fileReads,
        sessions,
        agentId: mainSession.id,
        store: shell,
        ...(onFileReadsProblem && { onProblem: onFileReadsProblem }),
      });

      stopListening = () => {
        stopForgetting();
        stopKeeping();
      };

      try {
        return await contribute({ options, parts, services, workingRoots, skillRoots });
      } catch (caughtError) {
        // An extension whose `activate` threw is not deactivated: it cleans up after itself.
        stopListening();
        throw caughtError;
      }
    },
    deactivate: () => stopListening(),
  });
}

/** The coding extension's tools and hooks, and what it provides and shares; throws if a hook is broken. */
async function contribute(params: {
  options: CodingExtensionOptions;
  parts: CodingParts;
  services: Services;
  workingRoots: WorkingRoots;
  skillRoots: SkillRoots;
}): Promise<Contributions> {
  const { options, parts, services, workingRoots, skillRoots } = params;
  const { permissions } = options;
  const outputs = services.find(OUTPUT_CAPTURE);
  const instructionHooks = createInstructionHooks({ parts, workingRoots, skillRoots });
  const projectHooks = await loadWorkspaceHooks({
    workspace: parts.workspace,
    instructionHooks,
    options,
  });
  const hooks = [...instructionHooks, ...projectHooks.hooks];
  const fileTools = createFileTools({ parts, workingRoots, skillRoots });
  const commandTools = createCommandTools({ parts, workingRoots, permissions, outputs });

  services.provide(CODING_RUN, {
    workspace: parts.workspace,
    workingRoots,
    skills: skillRoots,
    projectHooks: projectHooks.hooks,
    projectTrust: projectHooks.trust,
  });
  // Last, once nothing after it can fail: what is shared reaches sub-agents at once and is not
  // taken back, so an extension that then failed would leave its tools with them. Sub-agents
  // get the same hook objects, each running its own `sessionStart`.
  services.get(SUB_AGENTS).share({ tools: fileTools, taskTools: commandTools, hooks });

  return {
    tools: [...fileTools, ...commandTools],
    hooks,
    instructions: [{ name: CODING_SECTION, text: CODING_INSTRUCTIONS }],
  };
}
