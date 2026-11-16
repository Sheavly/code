import { describe, expect, it } from 'vitest';
import { LAST_EVENT_ID_HEADER } from '@sheavly/protocol/api/api.constants';
import { createClient } from '../../client/client.helper.js';
import { sseBody } from '../../testing/sse-body.fake.js';
import { watchApprovals } from '../approvals.helper.js';
import type { HeardApproval } from '../approvals.types.js';

const asked = (seq: number) => ({
  seq,
  at: 0,
  sessionId: 'main',
  kind: 'approval',
  update: {
    type: 'approval_requested',
    request: {
      id: `a${String(seq)}`,
      callId: 'c1',
      tool: 'run_command',
      command: 'git push',
      concerns: [],
      options: ['approve', 'skip'],
    },
  },
});

describe('watchApprovals', () => {
  it('reopens a dropped stream after the last entry heard, and hears each approval once', async () => {
    const resumed: (string | null)[] = [];
    const bodies = [
      sseBody({ entries: [asked(0), asked(1)], dropWith: new TypeError('terminated') }),
      sseBody({ entries: [asked(2), asked(3)] }),
    ];
    const client = createClient({
      url: 'http://backend.test',
      token: 'token',
      fetch: (_input, init) => {
        resumed.push(new Headers(init?.headers).get(LAST_EVENT_ID_HEADER));

        return Promise.resolve(new Response(bodies.shift()));
      },
    });
    const heard: HeardApproval[] = [];
    const stop = new AbortController();
    const { ended } = await watchApprovals({
      client,
      id: '00000000-0000-4000-8000-000000000001' as never,
      onApproval: (approval) => {
        heard.push(approval);
        // The watched stream has no end of its own: the caller leaves it.
        if (heard.length === 4) stop.abort();
      },
      signal: stop.signal,
    });

    await ended;

    expect(heard.map(({ update }) => ('request' in update ? update.request.id : ''))).toEqual([
      'a0',
      'a1',
      'a2',
      'a3',
    ]);
    expect(resumed).toEqual([null, '1']);
  });
});
