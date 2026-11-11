import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { createCodingHarness } from '../coding.helper.js';
import { CODING_INSTRUCTIONS } from '../../instructions/coding-instructions.prompt.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'coding-harness-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createCodingHarness', () => {
  it.each([undefined, '', 'REPLACEMENT'])(
    'keeps coding guidance before host extras with core replacement %s',
    async (baseInstructions) => {
      const harness = await createCodingHarness({
        provider: routedProvider({ hi: [say('hello')] }),
        title: 'hi',
        workspaceRoot: root,
        env: {},
        baseInstructions,
        instructions: 'HOST',
      });

      expect(harness.instructions.endsWith(`${CODING_INSTRUCTIONS}\n\nHOST`)).toBe(true);
      expect(harness.instructions.split(CODING_INSTRUCTIONS)).toHaveLength(2);
      expect(harness.instructions).toContain('Do not read .env or credential files');
      expect(CODING_INSTRUCTIONS.trim().split(/\s+/).length).toBeLessThanOrEqual(60);

      if (baseInstructions !== undefined) {
        expect(harness.instructions).toBe(
          [baseInstructions, CODING_INSTRUCTIONS, 'HOST'].filter(Boolean).join('\n\n'),
        );
      }
    },
  );

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
      'fileReads',
      'instructions',
      'mainSession',
      'processes',
      'provider',
      'sessions',
      'tasks',
      'workspace',
    ]);
  });
});
