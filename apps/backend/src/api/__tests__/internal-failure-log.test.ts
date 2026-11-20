import { describe, expect, it } from 'vitest';
import { Conversations } from '@sheavly/host/conversations/conversations.service';
import { useTempFolders } from '@sheavly/testing/files/temp-folders.fake';
import { createApiApp } from '../api.helper.js';
import { testBackend } from '../../testing/backend.fake.js';
import { TEST_INSTANCE_ID } from '../../testing/identity.fake.js';
import { TEST_SECRET, TEST_SERVER_VERSION, TEST_TOKEN } from '../../testing/testing.constants.js';

const folders = useTempFolders({ prefix: 'internal-failure-log-', names: ['app'] });

/** The backend's API over `pick`'s conversations, with what its log heard. */
function apiOver(pick: (real: Conversations) => Conversations) {
  const made = testBackend({ home: `${folders.base}/home`, workspace: folders.app });
  const logged: string[] = [];
  const app = createApiApp({
    conversations: pick(made.conversations),
    setup: made.setup,
    workspaces: made.workspaces,
    permissions: made.permissions,
    token: TEST_TOKEN,
    instanceId: TEST_INSTANCE_ID,
    serverVersion: TEST_SERVER_VERSION,
    log: (text) => logged.push(text),
  });
  const call = (path: string, init: { method: string; body?: string } = { method: 'GET' }) =>
    app.request(path, {
      ...init,
      headers: { authorization: `Bearer ${TEST_TOKEN}`, 'content-type': 'application/json' },
    });

  return { call, logged };
}

describe('an unexpected failure the API answers as internal', () => {
  it('tells the client nothing and the log its name and message, on one line, with no stack', async () => {
    const failure = new TypeError(`broke at /w/\u001b[31mfile\nsecond ${TEST_SECRET}`);
    const { call, logged } = apiOver(
      () =>
        new Conversations({
          create: () => {
            throw failure;
          },
        }),
    );
    const response = await call('/conversations', { method: 'POST', body: '{}' });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal', message: 'The server failed; see its log' },
    });
    expect(text).not.toContain('SECRET');
    expect(logged).toEqual([
      `api: request failed: TypeError: broke at /w/filesecond ${TEST_SECRET}\n`,
    ]);
    expect(logged.join('')).not.toContain('    at ');
  });

  it('logs nothing for a failure the client caused', async () => {
    const { call, logged } = apiOver((real) => real);
    const response = await call('/conversations/00000000-0000-4000-8000-0000000000ab');

    expect(response.status).toBe(404);
    expect(logged).toEqual([]);
  });
});
