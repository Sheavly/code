import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sheavlyHome } from '@sheavly/storage/home/home.helper';
import { trustStoreFor } from '../home.helper.js';

describe('trustStoreFor', () => {
  let base = '';
  let home = '';

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'trust-for-'));
    home = path.join(base, 'sheavly');
    await mkdir(home);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('keeps trust in the user’s folder, which a workspace inside it cannot use to trust itself', async () => {
    const store = trustStoreFor({ SHEAVLY_HOME: home });

    // A workspace that contains the folder would let the repo ship its own trust: refused.
    await expect(store.check({ root: base })).rejects.toThrow('inside the workspace');
    // A workspace beside the folder is fine.
    const project = path.join(base, 'project');

    await mkdir(project);
    expect(await store.check({ root: project })).toBe('untrusted');
  });

  it('puts trust elsewhere with SHEAVLY_TRUST_FILE, without moving the profiles', async () => {
    const elsewhere = path.join(base, 'throwaway', 'trust.json');
    const env = { SHEAVLY_HOME: home, SHEAVLY_TRUST_FILE: elsewhere };
    const store = trustStoreFor(env);

    await mkdir(path.dirname(elsewhere));
    // The refusal names the file the store lives in, which shows where trust is kept.
    await expect(store.check({ root: path.dirname(elsewhere) })).rejects.toThrow(elsewhere);
    expect(sheavlyHome(env)).toBe(home);
  });

  it('counts an empty SHEAVLY_TRUST_FILE as not set', async () => {
    const store = trustStoreFor({ SHEAVLY_HOME: home, SHEAVLY_TRUST_FILE: '' });

    await expect(store.check({ root: base })).rejects.toThrow(
      path.join(home, 'trusted-workspaces.json'),
    );
  });
});
