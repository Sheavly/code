import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { routedProvider, say, toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { memoryTrust } from '@sheavly/workspace/testing/trust.fake';
import { createBackendHarness } from '../harness.helper.js';
import type { BackendHarnessOptions } from '../harness.types.js';
import { askingPermissions } from '../../testing/permissions.fake.js';
import { untilSettled } from '../../testing/settled.fake.js';

let base: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'backend-scratch-')));
  await mkdir(path.join(base, 'project'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** A backend harness over the test project, with a scratch root, for `provider` to run. */
function openWithScratch(options: Pick<BackendHarnessOptions, 'provider' | 'onModelCall'>) {
  return createBackendHarness({
    ...options,
    title: 'go',
    workspaceRoot: path.join(base, 'project'),
    scratchRoot: path.join(base, 'scratch'),
    trustStore: new TrustStore({
      persistence: memoryTrust({ file: path.join(base, 'trusted.json') }),
    }),
    env: {},
    permissions: askingPermissions(),
  });
}

describe('the scratch folder in a backend run', () => {
  it('registers its hook by declared order, between skills and the working root', async () => {
    const harness = await openWithScratch({ provider: routedProvider({ go: [say('done')] }) });

    expect(harness.hooks.map((hook) => hook.name)).toEqual([
      'agents-md',
      'skills',
      'scratch',
      'working-root',
    ]);
  });

  it('is the parent’s folder for a sub-agent, which can write into it', async () => {
    const requests: ProviderRequest[] = [];
    // Known only once the harness exists (the main session's id), read when the helper runs.
    let folder = '';
    const harness = await openWithScratch({
      provider: routedProvider({
        go: [
          () => [
            toolCall({ id: 's1', name: 'start_agent', input: { title: 'Helper', task: 'help' } }),
            { type: 'done', stopReason: 'tool_use' },
          ],
          say('done'),
        ],
        help: [
          () => [
            toolCall({
              id: 'w1',
              name: 'write_file',
              input: { path: path.join(folder, 'handoff.md'), content: 'from child\n' },
            }),
            { type: 'done', stopReason: 'tool_use' },
          ],
          say('helped'),
        ],
      }),
      onModelCall: (request) => requests.push(request),
    });

    folder = path.join(base, 'scratch', harness.mainSession.id);

    const conversation = createConversation({
      hooks: harness.hooks,
      harness,
      tools: harness.tools,
      run: streamAgent,
    });
    const events = conversation.send('go');

    for await (const _event of events);
    await untilSettled({ harness, conversation });
    await conversation.close();

    const sub = requests.find((request) => request.messages[0]?.content === 'help');
    const told = sub?.messages.map((message) => message.content).join('\n');

    expect(told).toContain(folder);
    expect(await readFile(path.join(folder, 'handoff.md'), 'utf8')).toBe('from child\n');
  });
});
