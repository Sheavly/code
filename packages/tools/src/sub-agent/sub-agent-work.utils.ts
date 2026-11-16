import type { WorkDefinition, WorkInput } from '@sheavly/runtime/tasks/work.types';
import { agentWork } from '@sheavly/runtime/tasks/work.utils';

/**
 * The sub-agent kind: finite work, so its parent can group and await it and its session is held
 * open for it, named `agent` so a UI counts it apart from a command. The policy is stated here,
 * not defaulted by the registry at the call site.
 */
export function subAgentWork(input: WorkInput): WorkDefinition {
  return agentWork(input);
}
