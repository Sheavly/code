import os from 'node:os';
import path from 'node:path';
import { createAgentsMdHook } from '../runtime/agents-md/agents-md.helper.js';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import { FileLocks } from '../runtime/file-locks/file-locks.service.js';
import { ProcessRunner } from '../runtime/process/process.service.js';
import { loadProjectHooks } from '../runtime/project-hooks/project-hooks.helper.js';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { TrustStore } from '../runtime/trust/trust.service.js';
import { Workspace } from '../runtime/workspace/workspace.service.js';
import { createEditFileTool } from '../tools/edit-file/edit-file.tool.js';
import { createReadFileTool } from '../tools/read-file/read-file.tool.js';
import { createRunCommandTool } from '../tools/run-command/run-command.tool.js';
import { createWriteFileTool } from '../tools/write-file/write-file.tool.js';
import type { CodingHarness, CodingHarnessOptions } from './coding.types.js';
import { TRUST_STORE_PATH } from './coding.constants.js';
import { createHarness } from './host.helper.js';

/**
 * The user's workspace trust store: `SHEAVLY_TRUST_FILE`, or `trusted-workspaces.json` under
 * `$XDG_CONFIG_HOME/sheavly` (default `~/.config/sheavly`). Outside every repo, so a repo can't
 * trust itself. Shared by every coding host.
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
 * The coding preset on `createHarness`: opens the workspace, loads the project's `.sheavly` hooks
 * (if trusted) and the AGENTS.md hook, and adds the file tools and run_command. Sub-agents get the
 * file tools and the AGENTS.md hook, not run_command or the `.sheavly` hooks.
 */
export async function createCodingHarness(options: CodingHarnessOptions): Promise<CodingHarness> {
  const { workspaceRoot, skipAllowList = false, provider, title, onModelCall } = options;
  const workspace = await Workspace.open(workspaceRoot);
  // A broken `.sheavly` hook stops the host here, with the file and the reason. An untrusted
  // workspace loads none: `projectTrust` says why, for the UI to show.
  const projectHooks = await loadProjectHooks({
    root: workspace.root,
    trust: options.trustStore ?? trustStoreFromEnv(),
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
  const processes = new ProcessRunner();
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
