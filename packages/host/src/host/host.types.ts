import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { EntryStore } from '@sheavly/core/store/store.types';
import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { StoredLog } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/**
 * What any run needs, from the UI: the provider it picked and a title. Nothing here says which
 * tools or hooks a run gets; the UI composes those itself.
 */
export type HarnessOptions = {
  provider: Provider;
  /** Title of the main session (e.g. the prompt). */
  title: string;
  /** Host extras after the generic core (and the coding section when an app composes it with `composeCodingInstructions`). */
  instructions?: string | undefined;
  /** Replaces only the generic core. Omission uses the default; an empty string omits it. */
  baseInstructions?: string | undefined;
  /** Sees every model call (main session and sub-agents) before it is made. */
  onModelCall?: ((request: ProviderRequest) => void) | undefined;
  /** Pass registries in when a tool needs them before the harness exists (default: new ones). */
  tasks?: TaskRegistry;
  approvals?: ApprovalRegistry;
  /** Where the run's combined stream is kept; without it, only in memory (`SessionRegistry`). */
  entries?: EntryStore | undefined;
  /**
   * The stored log of a conversation being reopened (`readStoredLog`): the run carries on from it,
   * and its main session is the one that was stored, idle for the next prompt.
   */
  resume?: StoredLog | undefined;
};

/**
 * The services one run shares, for the UI to build its tools and hooks on and to pass to
 * `streamAgent`. It holds no tools and no hooks: what a run includes is the UI's choice.
 */
export type Harness = {
  provider: Provider;
  /** Stable composed text for direct runs and, by default, conversations. */
  instructions: string;
  sessions: SessionRegistry;
  mainSession: SessionRef;
  tasks: TaskRegistry;
  /**
   * Where tools ask the user to approve something (run_command's risky arguments). A UI
   * subscribes, renders each `approval_requested` its own way and answers with `respond`; with no
   * subscriber they're refused.
   */
  approvals: ApprovalRegistry;
};
