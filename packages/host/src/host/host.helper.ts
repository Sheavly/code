import type { Provider } from '@sheavly/core/provider/provider.types';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { Harness, HarnessOptions } from './host.types.js';
import { composeInstructions } from '../instructions/instructions.helper.js';

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
  const sessions = new SessionRegistry({
    ...(options.entries && { store: options.entries }),
    ...(options.resume && { resume: options.resume }),
  });
  const mainSession = sessions.restoredMain() ?? sessions.startMain({ title: title.slice(0, 60) });
  const approvals = options.approvals ?? new ApprovalRegistry();
  const tasks = options.tasks ?? new TaskRegistry();

  // Approvals and background tasks join the combined stream, in order with the events of the
  // call that asked or started them.
  approvals.observe((update) => sessions.publishApproval(update));
  tasks.observe((task) => sessions.publishTask(task));

  return {
    provider,
    instructions: composeInstructions(options),
    sessions,
    mainSession,
    tasks,
    approvals,
  };
}
