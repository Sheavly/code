import { describe, expect, it } from 'vitest';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { SummaryOptions } from '@sheavly/core/summary/summary.types';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import {
  calls,
  routedProvider,
  say,
  toolCall,
} from '@sheavly/testing/provider/routed-provider.fake';

const summary: SummaryOptions = {
  summarizer: { name: 'test', summarize: async () => ({ sections: [] }) },
};

/** Runs a main session that starts a sub-agent, which starts one of its own. */
async function runNested(options: { summarizeWith?: (provider: Provider) => SummaryOptions }) {
  const given: (SummaryOptions | undefined)[] = [];
  const sessions = new SessionRegistry();
  const tasks = new TaskRegistry();
  const provider = routedProvider({
    Main: [
      calls(toolCall({ id: 'm', name: 'start_agent', input: { title: 'A', task: 'Outer' } })),
      say('done'),
    ],
    Outer: [
      calls(toolCall({ id: 'o', name: 'start_agent', input: { title: 'B', task: 'Inner' } })),
      say('ok'),
    ],
    Inner: [say('inner done')],
  });
  const tool = createSubAgentTool({
    sessions,
    tasks,
    provider,
    tools: [],
    ...options,
    runAgent: (runOptions) => {
      given.push(runOptions.summary);

      return runSession(runOptions);
    },
  });
  const main = sessions.startMain({ title: 'Main' });

  await runSession({
    provider,
    tools: [tool],
    messages: [{ role: 'user', content: 'Main' }],
    tasks,
    session: { registry: sessions, ref: main },
  });

  return given;
}

describe('sub-agents and summaries', () => {
  it('build each sub-agent run’s summary from the provider that run is on, nested ones included', async () => {
    const builtFor: Provider[] = [];
    const given = await runNested({
      summarizeWith: (provider) => {
        builtFor.push(provider);

        return summary;
      },
    });

    expect(given).toHaveLength(2);
    expect(given[0]).toBe(summary);
    expect(given[1]).toBe(summary);
    // One per run, each built from the provider the sub-agent was given.
    expect(builtFor).toHaveLength(2);
  });

  it('pass none when the parent gave none', async () => {
    expect(await runNested({})).toEqual([undefined, undefined]);
  });
});
