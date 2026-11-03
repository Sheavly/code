import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { createCodingHarness } from '../coding.helper.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'coding-harness-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createCodingHarness', () => {
  it('opens the workspace and makes the shared services, and includes no tools or hooks', async () => {
    const harness = await createCodingHarness({
      provider: routedProvider({ hi: [say('hello')] }),
      title: 'hi',
      workspaceRoot: root,
      env: { PATH: process.env.PATH },
    });

    expect(harness.workspace.root).toBe(await realpath(root));
    expect(Object.keys(harness).sort()).toEqual([
      'approvals',
      'fileLocks',
      'mainSession',
      'processes',
      'provider',
      'sessions',
      'tasks',
      'workspace',
    ]);
  });
});
