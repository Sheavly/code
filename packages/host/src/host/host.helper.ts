import type { Provider } from '@sheavly/core/provider/provider.types';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { Harness, HarnessOptions } from './host.types.js';

/**
 * The services one run shares, for any LLM project: the provider the UI picked (seen by
 * `onModelCall` on every call, main session and sub-agents alike) and the session, task and
 * approval registries. It adds no tools and no hooks: the UI composes those from the packages'
 * factories (`createTaskTools`, `createSubAgentTool`, a coding UI's file tools) on these services.
 */
export function createHarness(options: HarnessOptions): Harness {
  const { title, onModelCall } = options;
  const provider: Provider = onModelCall
    ? {
        stream: (request) => {
          onModelCall(request);

          return options.provider.stream(request);
        },
      }
    : options.provider;
  const sessions = new SessionRegistry();

  return {
    provider,
    sessions,
    mainSession: sessions.startMain({ title: title.slice(0, 60) }),
    tasks: options.tasks ?? new TaskRegistry(),
    approvals: options.approvals ?? new ApprovalRegistry(),
  };
}
