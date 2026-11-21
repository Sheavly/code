import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useWorkers } from '../../server-lock/testing/server-lock-children.fake.js';
import { findRunningServer } from '../server-finder.helper.js';
import type { FoundServer } from '../server-finder.types.js';
import { describeNone } from '../server-finder.utils.js';
import {
  SAMPLE_TOKEN,
  scriptedVerify,
  sequencedVerify,
  useFinderPlace,
} from '../testing/server-finder.fake.js';

const place = useFinderPlace();
const workers = useWorkers();
const posix = describe.skipIf(process.platform === 'win32');
const VERIFIED = { status: 'verified', protocolVersion: '0.9.0' } as const;
const MISMATCH = {
  status: 'version_mismatch',
  older: 'server',
  client: '2.0.0',
  server: '1.0.0',
  message: 'The server is older: update it.',
} as const;

async function find(params: {
  verify: ReturnType<typeof scriptedVerify>;
  env?: Record<string, string | undefined>;
  home?: string;
  uid?: number;
  log?: (line: string) => void;
}): Promise<FoundServer> {
  return findRunningServer({
    home: params.home ?? place.home(),
    env: params.env ?? place.env(),
    uid: params.uid ?? place.uid,
    platform: 'linux',
    verify: params.verify,
    ...(params.log && { log: params.log }),
  });
}

/** A live server of the home: the lock held and the file published in its runtime folder. */
async function serveInRuntimeFolder(overrides: { pid?: number } = {}): Promise<string> {
  const directory = await place.runtimeFolder();

  await place.hold({ directory });
  await place.publish({ directory, overrides });

  return directory;
}

/** A live server in each folder: pid 111 in the runtime folder, pid 222 in the home folder. */
async function serveInBothFolders(): Promise<void> {
  await serveInRuntimeFolder({ pid: 111 });
  await place.hold({ directory: place.home() });
  await place.publish({ directory: place.home(), overrides: { pid: 222 } });
}

function reasonsOf(result: FoundServer) {
  return result.status === 'none' ? result.reasons : [];
}

posix('findRunningServer with a held lock and a published file', () => {
  it('returns the verified server with its token, after the handshake was asked with the file’s values', async () => {
    await serveInRuntimeFolder();

    const verify = scriptedVerify(VERIFIED);
    const result = await find({ verify });

    expect(result).toMatchObject({
      status: 'found',
      url: 'http://127.0.0.1:4317',
      token: SAMPLE_TOKEN,
      pid: 4242,
      serverVersion: '1.2.3',
      protocolVersion: '0.9.0',
    });
    expect(verify.calls).toEqual([
      expect.objectContaining({ url: 'http://127.0.0.1:4317', token: SAMPLE_TOKEN }),
    ]);
  });

  it('looks in the runtime folder first and stops at the first verified server', async () => {
    await serveInBothFolders();

    const verify = scriptedVerify(VERIFIED);
    const result = await find({ verify });

    expect(result).toMatchObject({ status: 'found', pid: 111 });
    expect(verify.calls).toHaveLength(1);
  });

  it('uses the home folder when the runtime folder holds nothing', async () => {
    await place.hold({ directory: place.home() });
    await place.publish({ directory: place.home(), overrides: { pid: 222 } });

    const result = await find({ verify: scriptedVerify(VERIFIED) });

    expect(result).toMatchObject({ status: 'found', pid: 222 });
  });

  it('uses the home folder alone when no runtime folder is set', async () => {
    await place.hold({ directory: place.home() });
    await place.publish({ directory: place.home() });

    expect(await find({ verify: scriptedVerify(VERIFIED), env: {} })).toMatchObject({
      status: 'found',
    });
  });

  it('passes its timeout to the handshake', async () => {
    await serveInRuntimeFolder();

    const verify = scriptedVerify(VERIFIED);

    await findRunningServer({
      home: place.home(),
      env: place.env(),
      uid: place.uid,
      platform: 'linux',
      verify,
      timeoutMs: 321,
    });

    expect(verify.calls[0]?.timeoutMs).toBe(321);
  });
});

posix('findRunningServer when there is no server to use', () => {
  it('says there is no file in either folder when nothing was published, and asks nothing', async () => {
    await place.privateFolder(place.home());

    const verify = scriptedVerify(VERIFIED);
    const result = await find({ verify });

    expect(reasonsOf(result).map((reason) => reason.problem)).toEqual(['no-file', 'no-file']);
    expect(verify.calls).toEqual([]);
  });

  it('does not use a file published somewhere else', async () => {
    const elsewhere = await place.privateFolder(path.join(place.xdg(), 'other'));

    await place.privateFolder(place.home());
    await place.hold({ directory: elsewhere });
    await place.publish({ directory: elsewhere });

    const verify = scriptedVerify(VERIFIED);

    expect((await find({ verify })).status).toBe('none');
    expect(verify.calls).toEqual([]);
  });

  it('treats a file whose lock is free as stale and never asks the handshake', async () => {
    const directory = await place.runtimeFolder();

    await place.publish({ directory });

    const verify = scriptedVerify(VERIFIED);
    const result = await find({ verify });

    expect(reasonsOf(result)[0]).toMatchObject({ problem: 'stale', directory });
    expect(verify.calls).toEqual([]);
  });

  it('treats the file a killed server left behind as stale and never asks the handshake', async () => {
    const directory = await place.runtimeFolder();

    await place.privateFolder(place.home());
    await workers.leaveStaleSocket({ home: place.home(), runtimeDir: directory });
    await place.publish({ directory });

    const verify = scriptedVerify(VERIFIED);
    const result = await find({ verify });

    expect(reasonsOf(result)[0]).toMatchObject({ problem: 'stale' });
    expect(verify.calls).toEqual([]);
  });

  it('does not hand out the token when the lock cannot be asked, and asks nothing', async () => {
    // A home folder whose lock socket path is too long to connect to: neither held nor free.
    const home = await place.privateFolder(path.join(place.xdg(), 'h'.repeat(120)));

    await place.publish({ directory: home });

    const verify = scriptedVerify(VERIFIED);
    const result = await find({ verify, env: {}, home });

    expect(reasonsOf(result)).toEqual([
      expect.objectContaining({ problem: 'lock-inconclusive', directory: home }),
    ]);
    expect(verify.calls).toEqual([]);
  });

  it('refuses a file that is a link, and names the problem', async () => {
    const directory = await place.runtimeFolder();

    await place.hold({ directory });
    await place.plant({ directory, as: 'link' });

    const verify = scriptedVerify(VERIFIED);
    const result = await find({ verify });

    expect(reasonsOf(result)[0]).toMatchObject({ problem: 'refused', refusal: 'link' });
    expect(verify.calls).toEqual([]);
  });

  it('refuses a file open to group and others', async () => {
    const directory = await place.runtimeFolder();

    await place.hold({ directory });
    await place.plant({ directory, as: { mode: 0o644 } });

    const verify = scriptedVerify(VERIFIED);
    const result = await find({ verify });

    expect(reasonsOf(result)[0]).toMatchObject({ problem: 'refused', refusal: 'too-open' });
    expect(verify.calls).toEqual([]);
  });

  it('refuses a folder that belongs to another user', async () => {
    const directory = await serveInRuntimeFolder();
    const verify = scriptedVerify(VERIFIED);
    const result = await find({ verify, uid: place.uid + 1 });

    expect(reasonsOf(result)[0]).toMatchObject({
      problem: 'refused',
      refusal: 'folder',
      detail: 'other-owner',
      directory,
    });
    expect(verify.calls).toEqual([]);
  });

  it('refuses a folder that others can write to', async () => {
    const directory = await place.runtimeFolder();

    await place.hold({ directory });
    await place.publish({ directory });
    await place.openFolder(directory);

    const verify = scriptedVerify(VERIFIED);
    const result = await find({ verify });

    expect(reasonsOf(result)[0]).toMatchObject({ refusal: 'folder', detail: 'too-open' });
    expect(verify.calls).toEqual([]);
  });

  it('records a file that is not a discovery file as invalid, and one of a newer format', async () => {
    const directory = await place.runtimeFolder();

    await place.hold({ directory });
    await place.publishText({ directory, text: '{"formatVersion":1}' });
    await place.privateFolder(place.home());
    await place.publishText({ directory: place.home(), text: '{"formatVersion":99}' });

    const result = await find({ verify: scriptedVerify(VERIFIED) });

    expect(reasonsOf(result).map((reason) => reason.problem)).toEqual(['invalid', 'newer-format']);
  });
});

posix('findRunningServer when the handshake does not verify', () => {
  it.each([
    [{ status: 'wrong_server' }, 'wrong-server'],
    [{ status: 'no_handshake' }, 'no-handshake'],
  ] as const)('records %j as %s and hands out nothing', async (answer, problem) => {
    await serveInRuntimeFolder();

    const result = await find({ verify: scriptedVerify(answer) });

    expect(result.status).toBe('none');
    expect(reasonsOf(result)[0]).toMatchObject({ problem });
  });

  it('records a handshake that throws as no answer, naming only the kind of failure', async () => {
    await serveInRuntimeFolder();

    const failure = new TypeError(`connect failed with ${SAMPLE_TOKEN}`);
    const result = await find({ verify: scriptedVerify(failure) });
    const reason = reasonsOf(result)[0];

    expect(reason).toMatchObject({ problem: 'no-answer' });
    expect(reason?.message).toContain('TypeError');
    expect(JSON.stringify(result)).not.toContain(SAMPLE_TOKEN);
  });

  it('returns a version mismatch without the token when no folder verified', async () => {
    await serveInRuntimeFolder();

    const result = await find({ verify: scriptedVerify(MISMATCH) });

    expect(result).toEqual(MISMATCH);
    expect(JSON.stringify(result)).not.toContain(SAMPLE_TOKEN);
  });

  it('prefers a verified server in a later folder over a mismatch in an earlier one', async () => {
    await serveInBothFolders();

    const result = await find({ verify: sequencedVerify([MISMATCH, VERIFIED]) });

    expect(result).toMatchObject({ status: 'found', pid: 222 });
  });

  it('keeps the mismatch when the later folder is not the server', async () => {
    await serveInBothFolders();

    const verify = sequencedVerify([MISMATCH, { status: 'wrong_server' }]);

    expect(await find({ verify })).toEqual(MISMATCH);
  });
});

posix('what findRunningServer reports', () => {
  it('never holds the token in a result that is not found, a message or a log line', async () => {
    const answers = [
      MISMATCH,
      { status: 'wrong_server' as const },
      { status: 'no_handshake' as const },
      new Error(`boom ${SAMPLE_TOKEN}`),
    ];

    await serveInRuntimeFolder();
    await place.plant({ directory: await place.privateFolder(place.home()), as: { mode: 0o644 } });

    for (const answer of answers) {
      const lines: string[] = [];
      const result = await find({
        verify: scriptedVerify(answer),
        log: (line) => lines.push(line),
      });
      const printed = result.status === 'none' ? describeNone(result) : [];

      expect(JSON.stringify(result)).not.toContain(SAMPLE_TOKEN);
      expect(lines.join('\n') + printed.join('\n')).not.toContain(SAMPLE_TOKEN);
      expect(reasonsOf(result).every((reason) => reason.message !== '')).toBe(true);
    }
  });

  it('prints one line per folder looked at, naming it', async () => {
    const directory = await place.runtimeFolder();

    await place.privateFolder(place.home());

    const lines = describeNone({
      status: 'none',
      reasons: reasonsOf(await find({ verify: scriptedVerify(VERIFIED) })),
    });

    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(directory);
    expect(describeNone({ status: 'none', reasons: [] })).toEqual(['No Sheavly server was found.']);
  });

  it('creates and changes nothing: no file, socket, folder or mtime', async () => {
    await serveInRuntimeFolder();
    await place.privateFolder(place.home());

    const before = await place.snapshot(path.dirname(place.home()));

    await find({ verify: scriptedVerify(VERIFIED) });
    await find({ verify: scriptedVerify(MISMATCH), env: {} });

    expect(await place.snapshot(path.dirname(place.home()))).toEqual(before);
  });

  it('creates nothing when no folder exists yet', async () => {
    const before = await place.snapshot(path.dirname(place.home()));

    expect((await find({ verify: scriptedVerify(VERIFIED) })).status).toBe('none');
    expect(await place.snapshot(path.dirname(place.home()))).toEqual(before);
  });
});
