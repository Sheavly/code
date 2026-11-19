import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { Script } from '@sheavly/testing/provider/provider.types';
import { say, toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import type { BackendHarness } from '../harness/harness.types.js';
import { sendPromptAndSettle } from './send-prompt.fake.js';

/** Test-only: a script step in which the model starts the sub-agent whose script is `help`. */
const startHelper: Script = () => [
  toolCall({ id: 'm1', name: 'start_agent', input: { title: 'Helper', task: 'help' } }),
  { type: 'done', stopReason: 'tool_use' },
];

/**
 * Test-only: the options that make a backend run's model start one sub-agent on `go`, and
 * `start`, which runs that prompt on the harness those options opened and returns the model
 * request each of the two sessions sent. Split in two so a test can act on the open run (an
 * extension's `share`) before the sub-agent starts.
 */
export function subAgentRun() {
  const requests: ProviderRequest[] = [];

  return {
    options: {
      scripts: { go: [startHelper, say('done')], help: [say('helped')] },
      onModelCall: (request: ProviderRequest) => requests.push(request),
    },
    start: async (harness: BackendHarness) => {
      await sendPromptAndSettle({ harness, prompt: 'go' });

      return {
        main: requests.find((request) => request.messages[0]?.content === 'go'),
        sub: requests.find((request) => request.messages[0]?.content === 'help'),
      };
    },
  };
}

/**
 * Test-only: runs `go` on a backend run opened by `open` (from `useBackendRuns`), in which the
 * model starts a sub-agent, and returns the system prompt each of the two sessions was sent.
 */
export async function promptsOf(params: {
  open: (options: {
    scripts: Record<string, Script[]>;
    onModelCall: (request: ProviderRequest) => void;
  }) => Promise<BackendHarness>;
}) {
  const run = subAgentRun();
  const harness = await params.open(run.options);
  const { main, sub } = await run.start(harness);

  return { main: main?.instructions, sub: sub?.instructions, harness };
}
