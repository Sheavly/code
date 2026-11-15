import { createDeleteFileTool } from '@sheavly/coding/delete-file/delete-file.tool';
import { createEditFileTool } from '@sheavly/coding/edit-file/edit-file.tool';
import { createGlobTool } from '@sheavly/coding/glob/glob.tool';
import { createGrepTool } from '@sheavly/coding/grep/grep.tool';
import { createCodingHarness } from '@sheavly/coding/preset/coding.helper';
import { createReadFileTool } from '@sheavly/coding/read-file/read-file.tool';
import { createReadSkillTool } from '@sheavly/coding/read-skill/read-skill.tool';
import { createRunCommandTool } from '@sheavly/coding/run-command/run-command.tool';
import { createStartServiceTool } from '@sheavly/coding/run-command/start-service.tool';
import { createSetWorkingRootTool } from '@sheavly/coding/working-root/set-working-root.tool';
import { createWorkingRootHook } from '@sheavly/coding/working-root/working-root-hook.helper';
import { memoryShellStore } from '@sheavly/workspace/working-root/memory-shell.helper';
import { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import { createWriteFileTool } from '@sheavly/coding/write-file/write-file.tool';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { createHistoryTools } from '@sheavly/tools/history/history.tool';
import { createMessageAgentTool } from '@sheavly/tools/sub-agent/message-agent.tool';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { createOutputTools } from '@sheavly/tools/output/output.tool';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { createWebFetchTool } from '@sheavly/tools/web-fetch/web-fetch.tool';
import { createWebSearchTool } from '@sheavly/tools/web-search/web-search.tool';
import { createTavilySearchBackend } from '@sheavly/tools/web-search-backends/tavily-search.helper';
import { createAgentsMdHook } from '@sheavly/workspace/agents-md/agents-md.helper';
import { createScratchHook } from '@sheavly/workspace/scratch/scratch-hook.helper';
import { loadProjectHooks } from '@sheavly/workspace/project-hooks/project-hooks.helper';
import { createSkillsHook } from '@sheavly/workspace/skills/skills.helper';
import type { BackendHarness, BackendHarnessOptions } from './harness.types.js';

/**
 * What a backend run includes, chosen here and nowhere else: the file tools, read_skill, optional web tools and
 * run_command, the task tools, sub-agents (with the file tools, read_skill, run_command on their own
 * tasks, the same hooks as the main run and enabled web tools) and message_agent; the AGENTS.md hook,
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
    webSearch = { backend: createTavilySearchBackend() },
    summarizeWith,
    keepAgentHistory,
    logOf,
    shell = memoryShellStore(),
    outputs,
    ...coding
  } = options;
  const harness = await createCodingHarness(coding);
  const { workspace, fileLocks, fileReads, processes, tasks, approvals, sessions, provider } =
    harness;
  // One per conversation, over its `shell.json`: the main session and every sub-agent share it.
  const workingRoots = new WorkingRoots({ store: shell, workspace, env: options.env });
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
  // The main session's id, so sub-agents running this same hook share their root agent's folder.
  const scratch = workspace.scratchRoot
    ? [createScratchHook({ workspace, agentId: harness.mainSession.id })]
    : [];
  const hooks = [
    agentsMd,
    skills,
    ...scratch,
    createWorkingRootHook({ workingRoots }),
    ...projectHooks.hooks,
  ];

  // A released session is forgotten for good, so what it was shown of the files goes with it.
  sessions.subscribe((update) => {
    if (update.type === 'session_released') fileReads.forgetAgent({ agent: update.session.id });
  });
  const fileTools = [
    createReadFileTool({ workspace, workingRoots, fileLocks, fileReads }),
    createGlobTool({ workspace, workingRoots, processes }),
    createGrepTool({ workspace, workingRoots, processes }),
    createWriteFileTool({ workspace, workingRoots, fileLocks, fileReads }),
    createEditFileTool({ workspace, workingRoots, fileLocks, fileReads }),
    createDeleteFileTool({ workspace, workingRoots, fileLocks, fileReads }),
    createSetWorkingRootTool({ workingRoots }),
    createReadSkillTool(skillRoots),
  ];
  const webTools = [
    ...(webFetch === false ? [] : [createWebFetchTool(webFetch)]),
    ...(webSearch === false ? [] : [createWebSearchTool(webSearch)]),
  ];

  const outputTools = outputs ? createOutputTools(outputs) : [];
  // The tools that start commands, for the registry of the session that owns them.
  const commandTools = (commandTasks: typeof tasks) => {
    const options = {
      workspace,
      workingRoots,
      permissions,
      tasks: commandTasks,
      approvals,
      processes,
      outputs,
      fileReads,
    };

    return [createRunCommandTool(options), createStartServiceTool(options)];
  };

  return {
    ...harness,
    workingRoots,
    tools: [
      ...fileTools,
      ...webTools,
      ...commandTools(tasks),
      ...outputTools,
      ...createTaskTools(tasks),
      createSubAgentTool({
        sessions,
        tasks,
        provider,
        baseInstructions: harness.instructions,
        ...(subAgentProvider && { selectProvider: subAgentProvider }),
        ...(summarizeWith && { summarizeWith }),
        ...(keepAgentHistory && { keepHistory: keepAgentHistory }),
        runAgent: runSession,
        tools: [...fileTools, ...webTools, ...outputTools],
        tasksTools: commandTools,
        // The same hook objects as the main run, each sub-agent running its own `sessionStart`:
        // a hook must keep no state of its own across sessions.
        hooks,
      }),
      createMessageAgentTool({ sessions }),
      // Only a kept conversation has logs to search.
      ...(logOf ? createHistoryTools({ sessions, logOf }) : []),
    ],
    hooks,
    skills: skillRoots,
    projectHooks: projectHooks.hooks,
    projectTrust: projectHooks.trust,
  };
}
