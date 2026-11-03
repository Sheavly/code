import type { Hook } from '@sheavly/core/hook/hook.types';
import type { ProjectTrust } from '@sheavly/workspace/project-hooks/project-hooks.types';
import type { TrustStore } from '@sheavly/workspace/trust/trust.service';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import type { Harness, HarnessOptions } from '@sheavly/host/host/host.types';

export type CodingHarnessOptions = Pick<HarnessOptions, 'provider' | 'title' | 'onModelCall'> & {
  /** The workspace root the agent is confined to (default: the current directory). */
  workspaceRoot?: string | undefined;
  skipAllowList?: boolean;
  /**
   * Which workspaces the user trusts to run `.sheavly/` hooks. Default: `trustStoreFromEnv()`.
   * Either way an untrusted workspace loads none.
   */
  trustStore?: TrustStore;
  /** Trust this workspace now (a host's `--trust`), so its `.sheavly/` hooks load. */
  trustWorkspace?: boolean;
};

/** A harness for coding in a workspace: its file tools, run_command, AGENTS.md and project hooks. */
export type CodingHarness = Harness & {
  workspace: Workspace;
  /** The project's `.sheavly` hooks; `hooks` has the AGENTS.md hook first, then these. */
  projectHooks: Hook[];
  /**
   * Whether the `.sheavly/` hooks ran: `untrusted` or `changed` means they were skipped, and a
   * UI should say why and how to trust the workspace.
   */
  projectTrust: ProjectTrust;
};
