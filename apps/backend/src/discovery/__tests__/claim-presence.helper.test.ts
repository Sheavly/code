import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerPresence } from '@sheavly/storage/discovery-file/server-presence.service';
import { claimServerPresence } from '../claim-presence.helper.js';

const UID = process.getuid?.() ?? 0;
let base: string;
let home: string;
let xdg: string;
let logs: string[];
const held: ServerPresence[] = [];

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'claim-presence-'));
  home = path.join(base, 'home');
  xdg = path.join(base, 'xdg');
  logs = [];
  await mkdir(xdg, { mode: 0o700 });
});

afterEach(async () => {
  for (const presence of held.splice(0)) await presence.release();
  await rm(base, { recursive: true, force: true });
});

function claim(discoverable: boolean) {
  return claimServerPresence({
    discoverable,
    home,
    env: { XDG_RUNTIME_DIR: xdg },
    uid: UID,
    log: (text) => logs.push(text),
  });
}

describe.skipIf(process.platform === 'win32')('claimServerPresence', () => {
  it('builds no presence for a server that is not discoverable: no lock, no folder', async () => {
    expect(await claim(false)).toEqual({ status: 'go', presence: undefined });

    expect(await readdir(xdg)).toEqual([]);
    expect(existsSync(home)).toBe(false);
  });

  it('takes the lock for a discoverable server and refuses a second one, naming where the lock is', async () => {
    const first = await claim(true);

    expect(first).toMatchObject({ status: 'go' });
    if (first.status === 'go' && first.presence) held.push(first.presence);

    const second = await claim(true);

    expect(second).toMatchObject({ status: 'refused' });
    expect(second.status === 'refused' && second.message).toContain('holds the lock at');
    expect(logs).toEqual([]);
  });

  it('goes on without a lock when the folder cannot be used, after a warning with a line break', async () => {
    await mkdir(home);
    await chmod(home, 0o755);

    const result = await claimServerPresence({
      discoverable: true,
      home,
      env: {},
      uid: UID,
      log: (text) => logs.push(text),
    });

    expect(result.status).toBe('go');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^Warning: .*\n$/);
  });
});
