import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
import { SYSTEM_PROMPT_EXTEND_GRANT } from '@sheavly/extension/instructions/instructions.constants';
import { fakeExtension, fakeInstruction } from '@sheavly/extension/testing/extension.fake';
import { createHarness } from '@sheavly/host/host/host.helper';
import { runServices } from '@sheavly/host/run-services/run-services.helper';
import type { RunLoop } from '@sheavly/host/run-services/run-services.types';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { createAgentsExtension } from '../agents.helper.js';

const SECTION = fakeInstruction({ name: 'guide', text: '# Guide\nDo the guided thing.' });

/**
 * Activates `agents` and then a `guide` that depends on it and contributes a section, as the
 * backend does with `coding`: the harness is built first, `agents` reads the prompt while it
 * activates, and the app gives the prompt the sections afterwards.
 */
async function startedSubAgentPrompt(params: { contribute: boolean }) {
  const harness = createHarness({
    provider: routedProvider({ go: [say('ok')] }),
    title: 'go',
    instructions: 'APP EXTRAS',
  });
  const seen: Parameters<RunLoop>[0][] = [];
  const runSession: RunLoop = (options) => {
    seen.push(options);

    return Promise.resolve({ reason: 'completed', messages: options.messages });
  };
  const host = new ExtensionHost({
    extensions: [
      createAgentsExtension(),
      fakeExtension({
        name: 'guide',
        dependsOn: ['agents'],
        grants: [SYSTEM_PROMPT_EXTEND_GRANT],
        contributes: { instructions: [SECTION] },
      }),
    ],
    services: runServices({ harness, runSession }),
  });
  const { contributions, failed } = await host.activate({ signal: new AbortController().signal });

  if (params.contribute) harness.systemPrompt.contribute({ sections: contributions.instructions });

  const input = { description: 'Inherit', title: 'Heir', task: 'Report your prompt.' };

  await runTool({
    tools: contributions.tools.filter((tool) => tool.name === 'start_agent'),
    call: { id: callIdSchema.parse('inherit'), name: 'start_agent', input },
    session: harness.mainSession,
    signal: AbortSignal.timeout(10_000),
  });
  await harness.tasks.nextSettled();

  return { failed, instructions: seen[0]?.instructions, harness };
}

describe('the sub-agents of the agents extension inherit the run’s system prompt', () => {
  it('start from the prompt as composed when they start, with the sections contributed after agents activated', async () => {
    const { failed, instructions, harness } = await startedSubAgentPrompt({ contribute: true });

    expect(failed).toEqual([]);
    expect(harness.instructions).toContain(SECTION.text);
    expect(instructions?.startsWith(`${harness.instructions}\n\n# Sub-agent role\n`)).toBe(true);
    expect(instructions?.split(SECTION.text)).toHaveLength(2);
    expect(instructions?.indexOf(SECTION.text)).toBeLessThan(
      instructions?.indexOf('APP EXTRAS') ?? 0,
    );
  });

  it('start from the prompt without them when nothing was contributed', async () => {
    const { instructions } = await startedSubAgentPrompt({ contribute: false });

    expect(instructions).not.toContain(SECTION.text);
    expect(instructions).toContain('APP EXTRAS');
  });
});
