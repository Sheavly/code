import { existsSync } from 'node:fs';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { runSession } from '../loop/stream-agent/stream-agent.helper.js';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { createMessageAgentTool } from '@sheavly/tools/sub-agent/message-agent.tool';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { HOST_MAX_TURNS } from './host.constants.js';
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
 * Wires one run with nothing about a workspace: the caller's tools and hooks, plus the task and
 * sub-agent tools and the session, task and approval registries. A coding host uses
 * `createCodingHarness` (`coding.helper.ts`), which builds on this. `onModelCall` sees every
 * model call, main session and sub-agents alike.
 */
export function createHarness(options: HarnessOptions): Harness {
  const { title, onModelCall, tools = [], hooks = [], subAgents = {} } = options;
  const provider: Provider = onModelCall
    ? {
        stream: (request) => {
          onModelCall(request);

          return options.provider.stream(request);
        },
      }
    : options.provider;
  const tasks = options.tasks ?? new TaskRegistry();
  const approvals = options.approvals ?? new ApprovalRegistry();
  const sessions = new SessionRegistry();
  const mainSession = sessions.startMain({ title: title.slice(0, 60) });

  return {
    provider,
    sessions,
    mainSession,
    tasks,
    approvals,
    hooks,
    tools: [
      ...tools,
      ...createTaskTools(tasks),
      createSubAgentTool({
        sessions,
        tasks,
        provider,
        runAgent: runSession,
        tools: subAgents.tools ?? [],
        hooks: subAgents.hooks ?? [],
        ...(subAgents.instructions !== undefined && { instructions: subAgents.instructions }),
        maxTurns: HOST_MAX_TURNS,
      }),
      createMessageAgentTool({ sessions }),
    ],
  };
}
