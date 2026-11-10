import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { ENTRY_TAIL_SIZE } from '@sheavly/runtime/sessions/sessions.constants';
import { runSession } from '../stream-agent.helper.js';

const DELTAS_PER_PROMPT = 20;
/** Enough prompts to fill the entry log's tail several times over before measuring. */
const WARMUP_PROMPTS = Math.ceil((ENTRY_TAIL_SIZE * 3) / DELTAS_PER_PROMPT);
const MEASURED_PROMPTS = 300;
/** Retained heap may wobble by this much between the two measurements; growth is far above it. */
const MARGIN_BYTES = 4 * 1024 * 1024;

/** Collects garbage on demand without needing `--expose-gc` on the test runner. */
function collectGarbage(): void {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;

  gc();
}

/** The heap still in use after a full collection, so only retained memory is counted. */
function retainedHeap(): number {
  collectGarbage();
  collectGarbage();

  return process.memoryUsage().heapUsed;
}

const reply = () => [
  ...Array.from({ length: DELTAS_PER_PROMPT }, (_, i) => ({
    type: 'text_delta' as const,
    text: `word ${String(i)} `,
  })),
  { type: 'done' as const, stopReason: 'end_turn' as const },
];

describe('a long-lived conversation', () => {
  it('stops growing in memory once its entry log is full', async () => {
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'Chat' });
    const prompt = async () => {
      registry.resume(ref.id);
      await runSession({
        provider: scriptedProvider([reply()]),
        tools: [],
        // Each prompt starts from fresh history: this measures what the harness keeps around a
        // run, not the conversation itself, which is sent in full by design.
        messages: [{ role: 'user', content: 'hi' }],
        session: { registry, ref },
        keepSession: true,
      });
    };

    registry.idle({ id: ref.id, outcome: 'completed' });

    for (let i = 0; i < WARMUP_PROMPTS; i++) await prompt();
    const afterWarmup = retainedHeap();

    for (let i = 0; i < MEASURED_PROMPTS; i++) await prompt();
    const afterMore = retainedHeap();

    expect(registry.retainedEntries).toBeLessThanOrEqual(ENTRY_TAIL_SIZE);
    expect(afterMore - afterWarmup).toBeLessThan(MARGIN_BYTES);
  });
});
