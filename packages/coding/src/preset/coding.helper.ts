import os from 'node:os';
import path from 'node:path';
import { createAgentsMdHook } from '@sheavly/workspace/agents-md/agents-md.helper';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';
import { ProcessRunner } from '@sheavly/workspace/process/process.service';
import type { Environment } from '@sheavly/core/environment/environment.types';
import { loadProjectHooks } from '@sheavly/workspace/project-hooks/project-hooks.helper';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { createEditFileTool } from '../edit-file/edit-file.tool.js';
import { createReadFileTool } from '../read-file/read-file.tool.js';
import { createRunCommandTool } from '../run-command/run-command.tool.js';
import { createWriteFileTool } from '../write-file/write-file.tool.js';
import type { CodingHarness, CodingHarnessOptions } from './coding.types.js';
import { TRUST_STORE_PATH } from './coding.constants.js';
import { createHarness } from '@sheavly/host/host/host.helper';

/**
 * The user's workspace trust store, from an environment the app passes in (`process.env`):
 * `SHEAVLY_TRUST_FILE`, or `trusted-workspaces.json` under `$XDG_CONFIG_HOME/sheavly` (default
 * `~/.config/sheavly`). Outside every repo, so a repo can't trust itself. Shared by every app.
 */
export function trustStoreFromEnv(env: Environment): TrustStore {
  // An empty variable (a blank line in .env) counts as not set.
  const set = (value: string | undefined) => (value === '' ? undefined : value);
  const configHome = set(env.XDG_CONFIG_HOME) ?? path.join(os.homedir(), '.config');

  return new TrustStore({
    file: set(env.SHEAVLY_TRUST_FILE) ?? path.join(configHome, ...TRUST_STORE_PATH),
  });
}

/**
 * The coding preset on `createHarness`: opens the workspace, loads the project's `.sheavly` hooks
 * (if trusted) and the AGENTS.md hook, and adds the file tools and run_command. Sub-agents get the
 * file tools and the AGENTS.md hook, not run_command or the `.sheavly` hooks.
 */
export async function createCodingHarness(options: CodingHarnessOptions): Promise<CodingHarness> {
  const { workspaceRoot, skipAllowList = false, provider, title, onModelCall, env } = options;
  const workspace = await Workspace.open(workspaceRoot);
  // A broken `.sheavly` hook stops the host here, with the file and the reason. An untrusted
  // workspace loads none: `projectTrust` says why, for the UI to show.
  const projectHooks = await loadProjectHooks({
    root: workspace.root,
    trust: options.trustStore,
    grant: options.trustWorkspace ?? false,
  });
  // run_command needs these before the harness exists; the harness then uses the same ones.
  const tasks = new TaskRegistry();
  const approvals = new ApprovalRegistry();
  const agentsMd = createAgentsMdHook({ root: workspace.root });
  // One set of file locks and one process runner for the whole harness: the main agent's tools
  // and every sub-agent's copies share them, so edits to one file never overlap and every
  // command the harness started is stopped when it exits.
  const fileLocks = new FileLocks();
  const processes = new ProcessRunner({ env });
  const fileTools = [
    createReadFileTool({ workspace }),
    createWriteFileTool({ workspace, fileLocks }),
    createEditFileTool({ workspace, fileLocks }),
  ];
  const harness = createHarness({
    provider,
    title,
    onModelCall,
    tasks,
    approvals,
    tools: [
      ...fileTools,
      createRunCommandTool({ workspace, skipAllowList, tasks, approvals, processes }),
    ],
    hooks: [agentsMd, ...projectHooks.hooks],
    subAgents: { tools: fileTools, hooks: [agentsMd] },
  });

  return {
    ...harness,
    workspace,
    projectHooks: projectHooks.hooks,
    projectTrust: projectHooks.trust,
  };
}
