import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@sheavly/client/client/client.helper';
import { verifyServer } from '@sheavly/client/client/verify.helper';
import { PROTOCOL_VERSION } from '@sheavly/protocol/version/protocol-version.constants';
import { findRunningServer } from '@sheavly/storage/server-finder/server-finder.helper';
import { serverNameHash } from '@sheavly/storage/server-runtime/server-runtime.helper';
import { treeSnapshot } from '../../testing/held-server.fake.js';
import { useServeProcesses } from '../../testing/serve-process.fake.js';

const places = useServeProcesses();
const uid = process.getuid?.() ?? 0;

function find(verify: typeof verifyServer) {
  const { home, xdg } = places.folders();

  return findRunningServer({ home, env: { XDG_RUNTIME_DIR: xdg }, uid, verify });
}

async function publishedToken(): Promise<string> {
  const { xdg, home } = places.folders();
  const file = path.join(xdg, 'sheavly', await serverNameHash({ home }), 'server.json');

  return (JSON.parse(await readFile(file, 'utf8')) as { token: string }).token;
}

describe.skipIf(process.platform === 'win32')('the finder against a real server process', () => {
  it('finds the running server with no url and no token, and the token it returns opens it', async () => {
    const server = await places.start();
    const verify = vi.fn(verifyServer);
    const before = await treeSnapshot(places.folders().xdg);
    const result = await find(verify);

    expect(result).toMatchObject({
      status: 'found',
      url: server.url,
      pid: server.pid,
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(verify).toHaveBeenCalledTimes(1);

    if (result.status !== 'found') throw new Error('not found');

    expect(result.token).toBe(await publishedToken());

    const answer = await createClient({ url: result.url, token: result.token }).call(
      'queryTrustedWorkspaces',
      { body: {} },
    );

    expect(answer).toBeDefined();

    const withoutToken = await fetch(`${result.url}/trusted-workspaces`, {
      method: 'QUERY',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(withoutToken.status).toBe(401);
    // The finder read and probed only: the runtime folder is as the server left it.
    expect(await treeSnapshot(places.folders().xdg)).toEqual(before);
  }, 60_000);

  it('finds nothing after kill -9: the file stays, the lock is free, and the handshake is never asked', async () => {
    const server = await places.start();

    await server.stop('SIGKILL');

    const token = await publishedToken();
    const verify = vi.fn(verifyServer);
    const before = await treeSnapshot(places.folders().base);
    const result = await find(verify);

    expect(result.status).toBe('none');
    expect(result).toMatchObject({ reasons: [{ problem: 'stale' }, { problem: 'no-file' }] });
    expect(verify).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(token);
    // Nothing was created, removed or touched: the stale file and socket are left as they were.
    expect(await treeSnapshot(places.folders().base)).toEqual(before);
  }, 60_000);
});
