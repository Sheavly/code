import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '@sheavly/client/testing/fake-server.fake';
import { BackendError } from '../../errors/backend.errors.js';
import type { Backend } from '../client.types.js';
import { trustFolderOnAttached } from '../trust-attached.helper.js';

const TOKEN = 'a-token-that-must-never-be-printed-0123456789';

function backendOn(server: ReturnType<typeof fakeServer>, attached: boolean): Backend {
  return {
    url: 'http://backend.test',
    token: TOKEN,
    fetch: server.fetch,
    stop: async () => undefined,
    ...(attached && { attached: true as const }),
  };
}

function trustServer() {
  return fakeServer({ trustWorkspace: () => undefined });
}

/** Runs `--trust` (or `args`) against `backend`; what it returned and what it wrote. */
async function trust(params: {
  backend: Backend;
  workspace?: string | undefined;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}) {
  const written: string[] = [];
  const folder = await trustFolderOnAttached({
    backend: params.backend,
    args: params.args ?? ['--trust'],
    workspace: params.workspace,
    env: params.env ?? {},
    write: (text) => written.push(text),
    ...(params.timeoutMs !== undefined && { timeoutMs: params.timeoutMs }),
  });

  return { folder, written: written.join('') };
}

const failureOf = (params: Parameters<typeof trust>[0]): Promise<unknown> =>
  trust(params).catch((caughtError: unknown) => caughtError);

describe('trustFolderOnAttached', () => {
  it('sends --trust to a backend it only connected to, for the folder the session works in', async () => {
    const server = trustServer();
    const { folder } = await trust({
      backend: backendOn(server, true),
      workspace: '/work/project',
    });

    expect(folder).toBe('/work/project');
    expect(server.calls.map(({ name, call }) => [name, call.body])).toEqual([
      ['trustWorkspace', { workspace: '/work/project' }],
    ]);
  });

  it('trusts the folder a started backend would and returns that same folder for the run', async () => {
    const server = trustServer();
    const backend = backendOn(server, true);
    const fromEnv = await trust({ backend, env: { WORKSPACE_ROOT: '/from/env' } });
    const fromCwd = await trust({ backend });

    expect(fromEnv.folder).toBe('/from/env');
    expect(fromCwd.folder).toBe(path.resolve(process.cwd()));
    expect(server.calls.map(({ call }) => call.body)).toEqual([
      { workspace: '/from/env' },
      { workspace: path.resolve(process.cwd()) },
    ]);
  });

  it.each([
    ['without --trust', true, ['hello']],
    ['to a backend the terminal started, which got --trust as its own flag', false, ['--trust']],
  ])('sends nothing %s and leaves the workspace as it came', async (_title, attached, args) => {
    const server = trustServer();

    for (const workspace of ['/work', undefined]) {
      const { folder } = await trust({ backend: backendOn(server, attached), workspace, args });

      expect(folder).toBe(workspace);
    }

    expect(server.calls).toEqual([]);
  });

  it('reports a refusal naming the folder, never the token, and keeps no cause', async () => {
    const server = fakeServer({
      trustWorkspace: () => ({
        refuse: { status: 403, code: 'forbidden', message: 'Trust is local only' },
      }),
    });
    const failure = await failureOf({ backend: backendOn(server, true), workspace: '/work' });

    expect(failure).toBeInstanceOf(BackendError);
    expect((failure as Error).message).toContain('/work');
    expect((failure as Error).message).toContain('403 Trust is local only');
    expect((failure as Error).cause).toBeUndefined();
  });

  it('reports a backend it cannot reach by the kind of error alone', async () => {
    const backend: Backend = {
      url: 'http://backend.test',
      token: TOKEN,
      fetch: () => Promise.reject(new TypeError(`connect failed ${TOKEN}`)),
      attached: true,
      stop: async () => undefined,
    };
    const failure = await failureOf({ backend, workspace: '/work' });

    expect(failure).toBeInstanceOf(BackendError);
    expect((failure as Error).message).toContain('TypeError');
    expect((failure as Error).message).not.toContain(TOKEN);
  });
});

describe('trustFolderOnAttached when the folder it chose is refused as a workspace', () => {
  const refusingFolder = () =>
    fakeServer({
      trustWorkspace: () => ({
        refuse: { status: 422, code: 'bad_request', message: 'it is the home folder' },
      }),
    });

  it('goes on without a folder and says so when the run named none (the demo)', async () => {
    const { folder, written } = await trust({
      backend: backendOn(refusingFolder(), true),
      env: { WORKSPACE_ROOT: '/home/me' },
    });

    expect(folder).toBeUndefined();
    expect(written).toContain('/home/me');
    expect(written).toContain('not trusted');
    expect(written).not.toContain(TOKEN);
  });

  it('still fails when the run named the folder itself (the chat)', async () => {
    const failure = await failureOf({
      backend: backendOn(refusingFolder(), true),
      workspace: '/home/me',
    });

    expect(failure).toBeInstanceOf(BackendError);
  });

  it('still fails for a refusal that is not about the folder, even with none named', async () => {
    const server = fakeServer({
      trustWorkspace: () => ({ refuse: { status: 403, code: 'forbidden', message: 'local only' } }),
    });

    expect(await failureOf({ backend: backendOn(server, true) })).toBeInstanceOf(BackendError);
  });
});

describe('trustFolderOnAttached against a backend that never answers', () => {
  let silent: Server | undefined;

  afterEach(async () => {
    silent?.closeAllConnections();
    await new Promise((resolve) => silent?.close(resolve));
  });

  async function silentBackend(): Promise<Backend> {
    const server = createServer(() => undefined);

    silent = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const address = server.address();

    if (typeof address !== 'object' || address === null) throw new TypeError('no address');

    return {
      url: `http://127.0.0.1:${String(address.port)}`,
      token: TOKEN,
      attached: true,
      stop: async () => undefined,
    };
  }

  it('gives up after the timeout with a BackendError that names no token', async () => {
    const failure = await failureOf({
      backend: await silentBackend(),
      workspace: '/work',
      timeoutMs: 150,
    });

    expect(failure).toBeInstanceOf(BackendError);
    expect((failure as Error).message).toContain('did not answer');
    expect(`${String((failure as Error).stack)}${(failure as Error).message}`).not.toContain(TOKEN);
    expect((failure as Error).cause).toBeUndefined();
  });
});
