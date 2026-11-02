import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { runSession } from '../loop/stream-agent/stream-agent.helper.js';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { createAgentsMdHook } from '../runtime/agents-md/agents-md.helper.js';
import { loadProjectHooks } from '../runtime/project-hooks/project-hooks.helper.js';
import { ApprovalRegistry } from '../runtime/approvals/approvals.service.js';
import { SessionRegistry } from '../runtime/sessions/sessions.service.js';
import { TaskRegistry } from '../runtime/tasks/tasks.service.js';
import { TrustStore } from '../runtime/trust/trust.service.js';
import { Workspace } from '../runtime/workspace/workspace.service.js';
import { createEditFileTool } from '../tools/edit-file/edit-file.tool.js';
import { createReadFileTool } from '../tools/read-file/read-file.tool.js';
import { createRunCommandTool } from '../tools/run-command/run-command.tool.js';
import { createMessageAgentTool } from '../tools/sub-agent/message-agent.tool.js';
import { createSubAgentTool } from '../tools/sub-agent/sub-agent.tool.js';
import { createTaskTools } from '../tools/tasks/tasks.tool.js';
import { createWriteFileTool } from '../tools/write-file/write-file.tool.js';
import { HOST_MAX_TURNS, TRUST_STORE_PATH } from './host.constants.js';
import type { Harness, HarnessOptions, ProviderSettings } from './host.types.js';
import { parseProviderEnv } from './host.validator.js';

/**
 * The model backend from the environment (and `.env`, if present): `ADAPTER` is "openai" (the
 * default) or "azure", each with its own keys. Shared by every host (the demo, the workbook).
 */
export function providerFromEnv(): ProviderSettings {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const env = parseProviderEnv(process.env);
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
 * The user's workspace trust store: `SHEAVLY_TRUST_FILE`, or `trusted-workspaces.json` under
 * `$XDG_CONFIG_HOME/sheavly` (default `~/.config/sheavly`). Outside every repo, so a repo can't
 * trust itself. Shared by every host.
 */
export function trustStoreFromEnv(): TrustStore {
  // An empty variable (a blank line in .env) counts as not set.
  const set = (value: string | undefined) => (value === '' ? undefined : value);
  const configHome = set(process.env.XDG_CONFIG_HOME) ?? path.join(os.homedir(), '.config');

  return new TrustStore({
    file: set(process.env.SHEAVLY_TRUST_FILE) ?? path.join(configHome, ...TRUST_STORE_PATH),
  });
}

/**
 * Wires one run the way every host does: the workspace, every tool (files, commands, tasks,
 * sub-agents), the AGENTS.md hook and the project's `.sheavly` hooks, and the session and task
 * registries. `onModelCall` sees every model call, main session and sub-agents alike.
 */
export async function createHarness(options: HarnessOptions): Promise<Harness> {
  const { workspaceRoot, skipAllowList = false, title, onModelCall } = options;
  const workspace = await Workspace.open(workspaceRoot);
  // A broken `.sheavly` hook stops the host here, with the file and the reason. An untrusted
  // workspace loads none: `projectTrust` says why, for the UI to show.
  const projectHooks = await loadProjectHooks({
    root: workspace.root,
    trust: options.trustStore ?? trustStoreFromEnv(),
    grant: options.trustWorkspace ?? false,
  });
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
  const approvals = new ApprovalRegistry();
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
    approvals,
    projectHooks: projectHooks.hooks,
    projectTrust: projectHooks.trust,
    hooks: [agentsMd, ...projectHooks.hooks],
    tools: [
      ...fileTools,
      createRunCommandTool({ workspace, skipAllowList, tasks, approvals }),
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
