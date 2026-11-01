import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { runSession } from '../loop/stream-agent/stream-agent.service.js';
import { DEFAULT_ADAPTER, DEFAULT_MODEL } from '../providers/adapters/adapters.constants.js';
import { createDefaultRegistry } from '../providers/adapters/adapters.service.js';
import { createAgentsMdHook } from '../runtime/agents-md/agents-md.service.js';
import { loadProjectHooks } from '../runtime/project-hooks/project-hooks.service.js';
import { SessionRegistry } from '../runtime/sessions/sessions.service.js';
import { TaskRegistry } from '../runtime/tasks/tasks.service.js';
import { Workspace } from '../runtime/workspace/workspace.service.js';
import { createEditFileTool } from '../tools/edit-file/edit-file.tool.js';
import { createReadFileTool } from '../tools/read-file/read-file.tool.js';
import { createRunCommandTool } from '../tools/run-command/run-command.tool.js';
import { createMessageAgentTool } from '../tools/sub-agent/message-agent.tool.js';
import { createSubAgentTool } from '../tools/sub-agent/sub-agent.tool.js';
import { createTaskTools } from '../tools/tasks/tasks.tool.js';
import { createWriteFileTool } from '../tools/write-file/write-file.tool.js';
import { HOST_MAX_TURNS } from './host.constants.js';
import type { Harness, HarnessOptions, ProviderSettings } from './host.types.js';

/**
 * The model backend from the environment (and `.env`, if present): `ADAPTER` is "openai" (the
 * default) or "azure", each with its own keys. Shared by every host (the demo, the workbook).
 */
export function providerFromEnv(): ProviderSettings {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const env = z
    .discriminatedUnion('ADAPTER', [
      z.object({
        ADAPTER: z.literal('openai'),
        OPENAI_API_KEY: z.string().min(1, 'Set OPENAI_API_KEY'),
        MODEL: z.string().default(DEFAULT_MODEL),
      }),
      z.object({
        ADAPTER: z.literal('azure'),
        AZURE_OPENAI_API_KEY: z.string().min(1, 'Set AZURE_OPENAI_API_KEY'),
        AZURE_OPENAI_BASE_URL: z.string().min(1, 'Set AZURE_OPENAI_BASE_URL'),
        AZURE_OPENAI_DEPLOYMENT: z.string().default(DEFAULT_MODEL),
        AZURE_OPENAI_API_VERSION: z
          .string()
          .optional()
          .transform((v) => (v === '' ? undefined : v)), // an empty line in .env means "not set"
      }),
    ])
    .parse({ ...process.env, ADAPTER: process.env.ADAPTER ?? DEFAULT_ADAPTER });
  const registry = createDefaultRegistry();

  if (env.ADAPTER === 'azure') {
    return {
      adapter: 'azure',
      model: env.AZURE_OPENAI_DEPLOYMENT,
      provider: registry.create('azure', {
        apiKey: env.AZURE_OPENAI_API_KEY,
        baseUrl: env.AZURE_OPENAI_BASE_URL,
        deployment: env.AZURE_OPENAI_DEPLOYMENT,
        apiVersion: env.AZURE_OPENAI_API_VERSION,
      }),
    };
  }

  return {
    adapter: 'openai',
    model: env.MODEL,
    provider: registry.create('openai', { apiKey: env.OPENAI_API_KEY, model: env.MODEL }),
  };
}

/**
 * Wires one run the way every host does: the workspace, every tool (files, commands, tasks,
 * sub-agents), the AGENTS.md hook and the project's `.sheavly` hooks, and the session and task
 * registries. `onModelCall` sees every model call, main session and sub-agents alike.
 */
export async function createHarness(options: HarnessOptions): Promise<Harness> {
  const { workspaceRoot, skipAllowList = false, title, onModelCall } = options;
  const workspace = await Workspace.open(workspaceRoot);
  // A broken `.sheavly` hook stops the host here, with the file and the reason.
  const projectHooks = await loadProjectHooks({ root: workspace.root });
  const provider: Provider = onModelCall
    ? {
        stream: (request) => {
          onModelCall(request);

          return options.provider.stream(request);
        },
      }
    : options.provider;
  const tasks = new TaskRegistry();
  const sessions = new SessionRegistry();
  const mainSession = sessions.startMain({ title: title.slice(0, 60) });
  const agentsMd = createAgentsMdHook({ root: workspace.root });
  const fileTools = [
    createReadFileTool({ workspace }),
    createWriteFileTool({ workspace }),
    createEditFileTool({ workspace }),
  ];

  return {
    workspace,
    provider,
    sessions,
    mainSession,
    tasks,
    projectHooks,
    hooks: [agentsMd, ...projectHooks],
    tools: [
      ...fileTools,
      createRunCommandTool({ workspace, skipAllowList, tasks }),
      ...createTaskTools(tasks),
      // Sub-agents get the file tools and the AGENTS.md hook (not the .sheavly hooks).
      createSubAgentTool({
        sessions,
        tasks,
        provider,
        runAgent: runSession,
        tools: fileTools,
        hooks: [agentsMd],
        maxTurns: HOST_MAX_TURNS,
      }),
      createMessageAgentTool({ sessions }),
    ],
  };
}
