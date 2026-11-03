import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type { CodingHarness } from '@sheavly/coding/preset/coding.types';
import type { ProviderSwitch } from '@sheavly/providers/switch/switch.service';
import type { ProjectTrust } from '@sheavly/workspace/project-hooks/project-hooks.types';
import type { SkillRoots } from '@sheavly/workspace/skills/skills.types';
import type { TrustStore } from '@sheavly/workspace/trust/trust.service';
import type { parseCliSettings } from './settings.validator.js';

/** What a terminal CLI read from its command line and environment. */
export type CliSettings = ReturnType<typeof parseCliSettings>;

/** One of the models in `MODELS`: the name `/model` switches to, its backend and deployment. */
export type ModelChoice = { name: string; adapter: string; model: string };

/**
 * The models `MODELS` lists: `switch` serves whichever is active (the first, at start) and is the
 * run's provider; `choices` is what it can switch to.
 */
export type ModelSwitch = { switch: ProviderSwitch; choices: ModelChoice[] };

/** Which model backend a run uses, and how the terminal reports it. */
export type ProviderSettings = {
  adapter: string;
  model: string;
  provider: Provider;
  /** Set when `MODELS` lists the models: `provider` is its switch, `adapter` and `model` its first. */
  models?: ModelSwitch | undefined;
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
  /** The user's home, for their `~/.sheavly/skills/` and `~/.agents/skills/`; omit for none. */
  home?: string | undefined;
  onModelCall?: ((request: ProviderRequest) => void) | undefined;
};

/** A terminal run: the coding services, and the tools and hooks the terminal includes. */
export type TerminalHarness = CodingHarness & {
  tools: Tool[];
  hooks: Hook[];
  /** Where the run's skills are found, for `/<skill>` and for reporting skills that didn't load. */
  skills: SkillRoots;
  /** The project's `.sheavly` hooks; `hooks` has the AGENTS.md and skills hooks first, then these. */
  projectHooks: Hook[];
  /** Whether the `.sheavly/` hooks ran: `untrusted` or `changed` says why they didn't. */
  projectTrust: ProjectTrust;
};

/** A terminal CLI's run: its harness, the backend and model it uses, and its CLI settings. */
export type CliHarness = {
  harness: TerminalHarness;
  adapter: string;
  model: string;
  settings: CliSettings;
  /** The models the chat can switch between (`/model`), when `MODELS` lists them. */
  models?: ModelSwitch | undefined;
};
