import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { HistoryToolOptions } from '@sheavly/tools/history/history.types';
import type { SubAgentOptions } from '@sheavly/tools/sub-agent/sub-agent.types';

/**
 * What the embedding app chooses about its sub-agents. The run's sessions, tasks, provider,
 * instructions and output store are not options: the extension reads them from the run services
 * (`@sheavly/extension/run-services/run-services.utils`), as any extension can.
 */
export type AgentsExtensionOptions = {
  subAgentProvider?: SubAgentOptions['selectProvider'] | undefined;
  summarizeWith?: SubAgentOptions['summarizeWith'] | undefined;
  keepAgentHistory?: SubAgentOptions['keepHistory'] | undefined;
  /** Where each session's durable history is; with it the run gets the history tools. */
  logOf?: HistoryToolOptions['logOf'] | undefined;
};

/** What an extension that depends on `agents` shares with the sub-agents it starts. */
export type SubAgentShare = {
  /** Tools sub-agents get as well as the main run (the file tools, web tools). */
  tools?: readonly Tool[] | undefined;
  /**
   * Tools that start background work (`run_command`): sub-agents get them on the run's shared
   * task registry, and with any of them present can inspect and cancel what they start.
   */
  taskTools?: readonly Tool[] | undefined;
  /** Hooks sub-agents run, as the main run does. Each runs its own `sessionStart`: keep no state across sessions. */
  hooks?: readonly Hook[] | undefined;
};

/**
 * The `sub-agents` service: one scope per consuming extension, write-only. `share` first checks
 * that the consumer's manifest declares `sub-agent:share` (`ExtensionUndeclaredError` otherwise)
 * and throws a `ScopeDeactivatedError` once the consumer or `agents` has stopped. It then copies
 * what it is given into lists only this extension's sub-agent tool reads, so a reader of the
 * service cannot call the shared tools (which close over grant-holding services) or change what
 * others shared. What a consumer shared is revoked when its scope is disarmed (it failed after
 * sharing, was rolled back, or stopped, or `agents` stopped): sub-agents started afterwards do
 * not get it, sub-agents already running keep what they were given, and the names are free again.
 */
export type SubAgentScope = {
  share: (contribution: SubAgentShare) => void;
};

/**
 * The scope `agents` keeps to itself, which consumer scopes delegate to: `share` records the
 * consumer that shared each entry (`owner`; none for `agents`' own output tools, which are never
 * revoked) and `revoke` takes back everything one owner shared. Never provided as a service.
 */
export type RawSubAgentScope = {
  share: (contribution: SubAgentShare, owner?: string) => void;
  revoke: (owner: string) => void;
};

/**
 * What sub-agents are given, filled in by `share` while the extensions that depend on `agents`
 * activate. The sub-agent tool reads these lists when it starts a sub-agent, not when it is
 * created, so what was shared after it was built still reaches the child. Never provided as a
 * service.
 */
export type SubAgentShared = {
  readonly tools: Tool[];
  readonly taskTools: Tool[];
  readonly hooks: Hook[];
};
