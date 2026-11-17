import type { Environment } from '@sheavly/core/environment/environment.types';
import type { Hook } from '@sheavly/core/hook/hook.types';
import type { ProjectTrust } from '@sheavly/workspace/project-hooks/project-hooks.types';
import type { SkillRoots } from '@sheavly/workspace/skills/skills.types';
import type { TrustStore } from '@sheavly/workspace/trust/trust.service';
import type { WorkingRootStore } from '@sheavly/workspace/working-root/working-root.types';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import type { CodingHarness } from '../preset/coding.types.js';
import type { CommandPermissions } from '../run-command/run-command.types.js';

/**
 * What the run decides about its coding tools; the extension builds everything else. The output
 * store (`OUTPUTS`, optional) comes from the run services, not options.
 */
export type CodingExtensionOptions = {
  /** The environment, for the working root and the home folder (an app passes `process.env`). */
  env: Environment;
  /** The services a coding run shares (`createCodingHarness`): workspace, locks, processes, registries. */
  harness: CodingHarness;
  /** What the user lets `run_command` do in this workspace. */
  permissions: CommandPermissions;
  /** The user's home, for their `~/.sheavly/skills/` and `~/.agents/skills/`; omit for none. */
  home?: string | undefined;
  /** Which workspaces the user trusts to run `.sheavly/` hooks. */
  trustStore: TrustStore;
  /** Trust this workspace now (`--trust`), so its `.sheavly/` hooks load. */
  trustWorkspace?: boolean | undefined;
  /** Where the conversation's working root and file reads are kept, shared by its agents. */
  shell: WorkingRootStore;
  /** Hears of a failure to restore or keep the conversation's file reads; the run goes on. */
  onFileReadsProblem?: ((caughtError: unknown) => void) | undefined;
};

/** What the coding extension provides to whoever composes the run (`CODING_RUN`). */
export type CodingRun = {
  /** The conversation's working root, shared by its main session and sub-agents. */
  workingRoots: WorkingRoots;
  /** Where the run's skills are found. */
  skills: SkillRoots;
  /** The project's `.sheavly` hooks, after the instruction hooks in the run's hooks. */
  projectHooks: readonly Hook[];
  /** Whether the `.sheavly/` hooks ran: `untrusted` or `changed` says why they didn't. */
  projectTrust: ProjectTrust;
};
