import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@sheavly/protocol/version/protocol-version.constants';
import { healthResponseSchema } from '@sheavly/protocol/version/version.validator';
import { useTempFolders } from '@sheavly/testing/files/temp-folders.fake';
import { testBackend } from '../../testing/backend.fake.js';
import { seedFakeModel } from '../../testing/seed-model.fake.js';
import {
  TEST_INSTANCE_ID_TEXT,
  TEST_LONG_TOKEN,
  TEST_SERVER_VERSION,
} from '../../testing/testing.constants.js';

const folders = useTempFolders({ prefix: 'health-route-', names: ['secret-workspace-xyz'] });

describe('GET /health', () => {
  it('answers exactly the status and the two versions, with no token', async () => {
    const backend = testBackend({ home: `${folders.base}/home`, workspace: folders.base });
    const response = await backend.app.request('/health');
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: 'ok',
      serverVersion: TEST_SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(Object.keys(healthResponseSchema.parse(body)).sort()).toEqual([
      'protocolVersion',
      'serverVersion',
      'status',
    ]);
  });

  it('reveals no path, process id, home folder, token or instance id, even with a conversation running', async () => {
    const workspace = folders['secret-workspace-xyz'];
    const backend = testBackend({
      home: `${folders.base}/home`,
      workspace,
      token: TEST_LONG_TOKEN,
    });

    await seedFakeModel(backend);

    const started = await backend.call('/conversations', { method: 'POST', body: {} });

    expect(started.status).toBe(201);

    const loggedByStart = [...backend.logged];

    const response = await backend.app.request('/health');
    const text = await response.text();
    const everything = JSON.stringify([[...response.headers.entries()], text]);

    expect(Object.keys(healthResponseSchema.parse(JSON.parse(text)))).toHaveLength(3);
    expect(JSON.parse(text)).toEqual({
      status: 'ok',
      serverVersion: TEST_SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });

    // The process id itself is a number a substring check can't tell from a version, so its key is checked.
    for (const secret of [
      'secret-workspace-xyz',
      folders.base,
      homedir(),
      'pid',
      TEST_LONG_TOKEN,
      TEST_INSTANCE_ID_TEXT,
    ]) {
      expect(everything).not.toContain(secret);
    }

    // Starting the conversation may log (skills found on this machine); asking health adds nothing.
    expect(backend.logged).toEqual(loggedByStart);
    await backend.conversations.closeAll();
  });
});
