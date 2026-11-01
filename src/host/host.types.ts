import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { SessionRef } from '@sheavly/core/session/session.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { SessionRegistry } from '../runtime/sessions/sessions.service.js';
import type { TaskRegistry } from '../runtime/tasks/tasks.service.js';
import type { Workspace } from '../runtime/workspace/workspace.service.js';

/** Which model backend a host runs against, read from the environment. */
export type ProviderSettings = {
  adapter: string;
  model: string;
  provider: Provider;
};

export type HarnessOptions = {
  provider: Provider;
  /** The workspace root the agent is confined to (default: the current directory). */
  workspaceRoot?: string | undefined;
  skipAllowList?: boolean;
  /** Title of the main session (e.g. the prompt). */
  title: string;
  /** Sees every model call (main session and sub-agents) before it is made. */
  onModelCall?: (request: ProviderRequest) => void;
};

/** Everything a host wires up for one run: the tools, hooks and registries `streamAgent` takes. */
export type Harness = {
  workspace: Workspace;
  provider: Provider;
  sessions: SessionRegistry;
  mainSession: SessionRef;
  tasks: TaskRegistry;
  tools: Tool[];
  /** Host hooks first (AGENTS.md), then the project's `.sheavly` hooks. */
  hooks: Hook[];
  projectHooks: Hook[];
};
