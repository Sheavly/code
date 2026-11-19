import type { Environment } from '@sheavly/core/environment/environment.types';
import type { Hook } from '@sheavly/core/hook/hook.types';
import type { DocumentStore } from '@sheavly/core/store/store.types';
import type { TaskStarter } from '@sheavly/extension/run-services/run-services.types';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import type { KeyedLocks } from '@sheavly/runtime/locks/keyed-locks.service';
import type { ProcessRunner } from '@sheavly/process/process/process.service';
import type { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import type { ProjectTrust } from '../project-hooks/project-hooks.types.js';
import type { CommandApprovals, CommandPermissions } from '../run-command/run-command.types.js';
import type { SkillRoots } from '../skills/skills.types.js';
import type { TrustStore } from '../trust/trust.service.js';

/**
 * What the run decides about its coding tools; the extension builds everything else (the
 * workspace, the file reads and the process runner). The sessions, background tasks, approvals,
 * main session and output store come from the run services, not options.
 */
export type CodingExtensionOptions = {
  /** The workspace root the agent is confined to (default: the current directory). */
  workspaceRoot?: string | undefined;
  /**
   * A shared scratch folder outside the repo that the file tools may also use. The app picks the
   * location (packages do not read env); it is created on open. Default: none.
   */
  scratchRoot?: string | undefined;
  /**
   * The environment commands start from, secrets scrubbed, and the one the working root and the
   * home folder are resolved in (an app passes `process.env`).
   */
  env: Environment;
  /**
   * The locks every file tool of this run takes. Pass one set to every run of an app that has
   * several at once, so two runs editing one file take turns (they key by real path, so one set
   * serves any number of folders). Default: a set of this run's own.
   */
  fileLocks?: KeyedLocks | undefined;
  /** What the user lets `run_command` do in this workspace. */
  permissions: CommandPermissions;
  /** The user's home, for their `~/.sheavly/skills/` and `~/.agents/skills/`; omit for none. */
  home?: string | undefined;
  /** Which workspaces the user trusts to run `.sheavly/` hooks. */
  trustStore: TrustStore;
  /** Trust this workspace now (`--trust`), so its `.sheavly/` hooks load. */
  trustWorkspace?: boolean | undefined;
  /** Where the conversation's working root and file reads are kept, shared by its agents. */
  shell: DocumentStore;
  /** Hears of a failure to restore or keep the conversation's file reads; the run goes on. */
  onFileReadsProblem?: ((caughtError: unknown) => void) | undefined;
};

/**
 * What the coding extension's tools and hooks are built on: the parts it makes itself at
 * activation, and the run services it reads under its grants.
 */
export type CodingParts = {
  workspace: Workspace;
  /** Shared by every file tool, the main agent's and each sub-agent's, so edits never overlap. */
  fileLocks: KeyedLocks;
  /** Which files each agent has read, so `edit_file` refuses one an agent never saw. */
  fileReads: FileReads;
  /** Runs every command; each one it started is stopped when the process exits. */
  processes: ProcessRunner;
  /** Where background commands start (`BACKGROUND_TASKS`). */
  tasks: TaskStarter;
  /** Where an unapproved command asks the user (`APPROVALS`). */
  approvals: CommandApprovals;
  /** The main session: whose folder the scratch source names and whose reads are kept. */
  mainSession: SessionRef;
};

/** What the coding extension provides to whoever composes the run (`CODING_RUN`). */
export type CodingRun = {
  /** The workspace the file tools are confined to: the extension opened it. */
  workspace: Workspace;
  /** The conversation's working root, shared by its main session and sub-agents. */
  workingRoots: WorkingRoots;
  /** Where the run's skills are found. */
  skills: SkillRoots;
  /** The project's `.sheavly` hooks, after the instruction hooks in the run's hooks. */
  projectHooks: readonly Hook[];
  /** Whether the `.sheavly/` hooks ran: `untrusted` or `changed` says why they didn't. */
  projectTrust: ProjectTrust;
};
