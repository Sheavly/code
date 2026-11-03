import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type { CodingHarness } from '@sheavly/coding/preset/coding.types';
import type { ProjectTrust } from '@sheavly/workspace/project-hooks/project-hooks.types';
import type { TrustStore } from '@sheavly/workspace/trust/trust.service';

/** Which model backend a run uses, and how the terminal reports it. */
export type ProviderSettings = {
  adapter: string;
  model: string;
  provider: Provider;
};

/** What the terminal's demo and workbook decide about a run. */
export type TerminalHarnessOptions = {
  provider: Provider;
  title: string;
  /** The workspace root the agent is confined to (default: the current directory). */
  workspaceRoot?: string | undefined;
  /** The environment commands start from (`process.env`; secrets are scrubbed). */
  env: Environment;
  /** Which workspaces the user trusts to run `.sheavly/` hooks. */
  trustStore: TrustStore;
  /** Trust this workspace now (`--trust`), so its `.sheavly/` hooks load. */
  trustWorkspace?: boolean;
  /** Let run_command run any shell command (`RUN_COMMAND_SKIP_ALLOW_LIST=true`). */
  skipAllowList?: boolean;
  onModelCall?: ((request: ProviderRequest) => void) | undefined;
};

/** A terminal run: the coding services, and the tools and hooks the terminal includes. */
export type TerminalHarness = CodingHarness & {
  tools: Tool[];
  hooks: Hook[];
  /** The project's `.sheavly` hooks; `hooks` has the AGENTS.md hook first, then these. */
  projectHooks: Hook[];
  /** Whether the `.sheavly/` hooks ran: `untrusted` or `changed` says why they didn't. */
  projectTrust: ProjectTrust;
};
