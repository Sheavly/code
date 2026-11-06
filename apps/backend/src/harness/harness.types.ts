import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type { EntryStore } from '@sheavly/core/store/store.types';
import type { CodingHarness } from '@sheavly/coding/preset/coding.types';
import type { CommandPermissions } from '@sheavly/coding/run-command/run-command.types';
import type { StoredLog } from '@sheavly/runtime/sessions/sessions.types';
import type { ProviderSwitch } from '@sheavly/providers/switch/switch.service';
import type { ModelChoice } from '@sheavly/protocol/server/server.types';
import type { ProjectTrust } from '@sheavly/workspace/project-hooks/project-hooks.types';
import type { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';
import type { SkillRoots } from '@sheavly/workspace/skills/skills.types';
import type { TrustStore } from '@sheavly/workspace/trust/trust.service';
import type { parseCliSettings, parseRunEnv } from './settings.validator.js';
import type { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';

/** What the backend's command line and environment set for a run. */
export type CliSettings = ReturnType<typeof parseCliSettings>;

/** How the backend runs each conversation: the CLI's settings and the run settings it reads. */
export type ServedSettings = CliSettings & ReturnType<typeof parseRunEnv>;

/**
 * A profile's usable models: `switch` serves whichever is active (the profile's last, else the
 * first) and is the run's provider, keyed by model id; `choices` is what it can switch to.
 */
export type ModelSwitch = { switch: ProviderSwitch; choices: ModelChoice[] };

/** What the backend decides about a run. */
export type BackendHarnessOptions = {
  provider: Provider;
  subAgentProvider?: Parameters<typeof createSubAgentTool>[0]['selectProvider'];
  title: string;
  /** The workspace root the agent is confined to (default: the current directory). */
  workspaceRoot?: string | undefined;
  /** The environment commands start from (`process.env`; secrets are scrubbed). */
  env: Environment;
  /** Which workspaces the user trusts to run `.sheavly/` hooks. */
  trustStore: TrustStore;
  /** Trust this workspace now (`--trust`), so its `.sheavly/` hooks load. */
  trustWorkspace?: boolean;
  /** What the user lets `run_command` do in this workspace (see `CommandPermissions`). */
  permissions: CommandPermissions;
  /** The user's home, for their `~/.sheavly/skills/` and `~/.agents/skills/`; omit for none. */
  home?: string | undefined;
  onModelCall?: ((request: ProviderRequest) => void) | undefined;
  /** Where the run's combined stream is kept (see `HarnessOptions.entries`); none keeps it in memory. */
  entries?: EntryStore | undefined;
  /** The stored log of a conversation being reopened (see `HarnessOptions.resume`). */
  resume?: StoredLog | undefined;
  /** The file locks shared with every other run of this backend (see `CodingHarnessOptions`). */
  fileLocks?: FileLocks | undefined;
};

/** A run on the backend: the coding services, and the tools and hooks it includes. */
export type BackendHarness = CodingHarness & {
  tools: Tool[];
  hooks: Hook[];
  /** Where the run's skills are found, for `/<skill>` and for reporting skills that didn't load. */
  skills: SkillRoots;
  /** The project's `.sheavly` hooks; `hooks` has the AGENTS.md and skills hooks first, then these. */
  projectHooks: Hook[];
  /** Whether the `.sheavly/` hooks ran: `untrusted` or `changed` says why they didn't. */
  projectTrust: ProjectTrust;
};
