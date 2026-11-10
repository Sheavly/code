import { describe, expect, it } from 'vitest';
import { approvalUpdateSchema } from '@sheavly/protocol/approval/approval.validator';
import { streamEntrySchema } from '@sheavly/protocol/stream/stream.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { followApprovals } from '../approvals.helper.js';
import type { HeardApproval } from '../approvals.types.js';

const details = { title: 'Helper', state: 'running', startedAt: 1 };
const started = (seq: number, id: string): StreamEntry =>
  streamEntrySchema.parse({
    seq,
    at: 0,
    sessionId: id,
    kind: 'update',
    update: {
      type: 'session_started',
      session: { id, parentId: 'main', startedByCall: 'c0', rootId: 'main', depth: 2, ...details },
    },
  });
const asked = (seq: number, sessionId: string, id: string): StreamEntry =>
  streamEntrySchema.parse({
    seq,
    at: 0,
    sessionId,
    kind: 'approval',
    update: approvalUpdateSchema.parse({
      type: 'approval_requested',
      request: {
        id,
        callId: 'c1',
        tool: 'run_command',
        command: 'git push',
        concerns: [],
        options: ['approve', 'skip'],
      },
    }),
  });

async function* of(...entries: StreamEntry[]) {
  await Promise.resolve();
  yield* entries;
}

async function heardFrom(entries: AsyncIterable<StreamEntry>) {
  const heard: HeardApproval[] = [];

  await followApprovals({
    entries,
    onApproval: (approval) => heard.push(approval),
    signal: new AbortController().signal,
  });

  return heard;
}

describe('followApprovals', () => {
  it('names the sub-agent that asked, from the session update it saw before', async () => {
    const [heard] = await heardFrom(of(started(0, 's2'), asked(1, 's2', 'a1')));

    expect(heard?.sessionId).toBe('s2');
    expect(heard?.agent).toMatchObject({ id: 's2', title: 'Helper', depth: 2 });
  });

  it('gives no agent for the main session, or for a session it never saw start', async () => {
    const heard = await heardFrom(of(asked(0, 'main', 'a1'), asked(1, 's9', 'a2')));

    expect(heard.map(({ agent }) => agent)).toEqual([undefined, undefined]);
    expect(heard.map(({ sessionId }) => sessionId)).toEqual(['main', 's9']);
  });

  it('passes every entry on, approvals included, in order', async () => {
    const seen: number[] = [];

    await followApprovals({
      entries: of(started(0, 's2'), asked(1, 's2', 'a1')),
      onApproval: () => undefined,
      onEntry: (entry) => seen.push(entry.seq),
      signal: new AbortController().signal,
    });

    expect(seen).toEqual([0, 1]);
  });

  it('ends quietly when stopped, and fails on any other error', async () => {
    const stop = new AbortController();
    const stopped = followApprovals({
      entries: (async function* () {
        await Promise.resolve();
        stop.abort();
        yield* [];
        throw new Error('reset by the abort');
      })(),
      onApproval: () => undefined,
      signal: stop.signal,
    });

    await expect(stopped).resolves.toBeUndefined();

    const failed = followApprovals({
      entries: (async function* () {
        await Promise.resolve();
        yield* [];
        throw new Error('backend went away');
      })(),
      onApproval: () => undefined,
      signal: new AbortController().signal,
    });

    await expect(failed).rejects.toThrow('backend went away');
  });
});
