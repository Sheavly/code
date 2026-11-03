import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/** Which model backend a host runs against, read from the environment. */
export type ProviderSettings = {
  adapter: string;
  model: string;
  provider: Provider;
};

/** What any run needs: nothing here assumes a workspace, files or a trusted project. */
export type HarnessOptions = {
  provider: Provider;
  /** Title of the main session (e.g. the prompt). */
  title: string;
  /** Sees every model call (main session and sub-agents) before it is made. */
  onModelCall?: ((request: ProviderRequest) => void) | undefined;
  /** The main session's own tools; the task and sub-agent tools are added after them. */
  tools?: Tool[];
  /** The main session's hooks, in the order they run. */
  hooks?: Hook[];
  /** What sub-agents get. They inherit none of the main session's tools or hooks. */
  subAgents?: { tools?: Tool[]; hooks?: Hook[]; instructions?: string };
  /** Pass registries in when a tool needs them before the harness exists (default: new ones). */
  tasks?: TaskRegistry;
  approvals?: ApprovalRegistry;
};

/** Everything a host wires up for one run: the tools, hooks and registries `streamAgent` takes. */
export type Harness = {
  provider: Provider;
  sessions: SessionRegistry;
  mainSession: SessionRef;
  tasks: TaskRegistry;
  /**
   * Where tools ask the user to approve something (run_command's risky arguments). A UI
   * subscribes, renders each `approval_requested` its own way and answers with `respond`; with no
   * subscriber they're refused.
   */
  approvals: ApprovalRegistry;
  tools: Tool[];
  hooks: Hook[];
};
