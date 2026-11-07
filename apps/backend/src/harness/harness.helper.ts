import { createEditFileTool } from '@sheavly/coding/edit-file/edit-file.tool';
import { createCodingHarness } from '@sheavly/coding/preset/coding.helper';
import { createReadFileTool } from '@sheavly/coding/read-file/read-file.tool';
import { createReadSkillTool } from '@sheavly/coding/read-skill/read-skill.tool';
import { createRunCommandTool } from '@sheavly/coding/run-command/run-command.tool';
import { createWriteFileTool } from '@sheavly/coding/write-file/write-file.tool';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { createMessageAgentTool } from '@sheavly/tools/sub-agent/message-agent.tool';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { createWebFetchTool } from '@sheavly/tools/web-fetch/web-fetch.tool';
import { createAgentsMdHook } from '@sheavly/workspace/agents-md/agents-md.helper';
import { loadProjectHooks } from '@sheavly/workspace/project-hooks/project-hooks.helper';
import { createSkillsHook } from '@sheavly/workspace/skills/skills.helper';
import type { BackendHarness, BackendHarnessOptions } from './harness.types.js';

/**
 * What a backend run includes, chosen here and nowhere else: the file tools, read_skill, optional web_fetch and
 * run_command, the task tools, sub-agents (with the file tools, read_skill, and the AGENTS.md and
 * skills hooks and enabled web_fetch, not run_command or the `.sheavly` hooks) and message_agent; the AGENTS.md hook,
 * the skills hook (the project's skills, and the user's when `home` is set), then the workspace's
 * `.sheavly/` hooks if it is trusted. The packages provide the pieces and the shared services,
 * never the choice. Skills are instructions, like AGENTS.md, so workspace trust doesn't gate them.
 */
export async function createBackendHarness(
  options: BackendHarnessOptions,
): Promise<BackendHarness> {
  const {
    trustStore,
    trustWorkspace = false,
    permissions,
    home,
    subAgentProvider,
    webFetch = {},
    ...coding
  } = options;
  const harness = await createCodingHarness(coding);
  const { workspace, fileLocks, fileReads, processes, tasks, approvals, sessions, provider } =
    harness;
  // A broken `.sheavly` hook stops the run here, with the file and the reason. An untrusted
  // workspace loads none: `projectTrust` says why, for a UI to show.
  const projectHooks = await loadProjectHooks({
    root: workspace.root,
    trust: trustStore,
    grant: trustWorkspace,
  });
  const agentsMd = createAgentsMdHook({ root: workspace.root });
  const skillRoots = { root: workspace.root, home };
  const skills = createSkillsHook(skillRoots);
  const fileTools = [
    createReadFileTool({ workspace, fileReads }),
    createWriteFileTool({ workspace, fileLocks, fileReads }),
    createEditFileTool({ workspace, fileLocks, fileReads }),
    createReadSkillTool(skillRoots),
  ];
  const webTools = webFetch === false ? [] : [createWebFetchTool(webFetch)];

  return {
    ...harness,
    tools: [
      ...fileTools,
      ...webTools,
      createRunCommandTool({ workspace, permissions, tasks, approvals, processes }),
      ...createTaskTools(tasks),
      createSubAgentTool({
        sessions,
        tasks,
        provider,
        ...(subAgentProvider && { selectProvider: subAgentProvider }),
        runAgent: runSession,
        tools: [...fileTools, ...webTools],
        hooks: [agentsMd, skills],
      }),
      createMessageAgentTool({ sessions }),
    ],
    hooks: [agentsMd, skills, ...projectHooks.hooks],
    skills: skillRoots,
    projectHooks: projectHooks.hooks,
    projectTrust: projectHooks.trust,
  };
}
