import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { useFileLocks } from '@sheavly/workspace/testing/file-locks.fake';
import { agentIdFor, useFileReads } from '@sheavly/workspace/testing/file-reads.fake';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { createReadFileTool } from '../read-file.tool.js';
import { isFileRead } from '../read-file.utils.js';
import { isEnvFile } from '../../files/files.utils.js';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';

let base: string;
let root: string;
let workspace: Workspace;
const signal = new AbortController().signal;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'read-file-test-'));
  root = path.join(base, 'workspace');
  await mkdir(path.join(root, 'nested'), { recursive: true });
  await writeFile(path.join(root, 'index.ts'), 'export const answer = 42;\n');
  await writeFile(path.join(root, '.env'), 'SECRET=hunter2\n');
  await writeFile(path.join(root, '.env.local'), 'SECRET=hunter2\n');
  await writeFile(path.join(root, 'nested', '.env.production'), 'SECRET=hunter2\n');
  await symlink(path.join(root, '.env'), path.join(root, 'innocent.txt'));
  await writeFile(path.join(base, 'outside.txt'), 'outside secret\n');
  workspace = await Workspace.open(root);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const fileLocks = useFileLocks();
const fileReads = useFileReads();

const read = (
  filePath: string,
  range: { startLine?: number; endLine?: number } = {},
  session?: SessionRef,
) =>
  runTool({
    tools: [
      createReadFileTool({
        workspace,
        fileLocks: fileLocks.current,
        fileReads: fileReads.current,
      }),
    ],
    call: {
      id: callIdSchema.parse('1'),
      name: 'read_file',
      input: { description: `reading ${filePath}`, path: filePath, ...range },
    },
    signal,
    ...(session && { session }),
  });

describe('read_file', () => {
  it('reads a file inside the workspace', async () => {
    expect(await read('index.ts')).toMatchObject({
      isError: false,
      content: 'export const answer = 42;\n',
    });
  });

  it('reads a line range, and caps a big file at 1000 lines with a note (not an error)', async () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `row ${i + 1}`).join('\n');

    await writeFile(path.join(root, 'big.txt'), `${lines}\n`);

    const range = await read('big.txt', { startLine: 10, endLine: 12 });
    const whole = await read('big.txt');
    const tooMuch = await read('big.txt', { startLine: 1, endLine: 5000 });

    expect(range).toMatchObject({ isError: false });
    expect(range.content).toBe(
      'row 10\nrow 11\nrow 12\n\n[Showing lines 10–12 of 1200. To read on, call read_file with startLine 13.]',
    );
    expect(whole).toMatchObject({ isError: false });
    expect(whole.content).toContain('row 1000\n\n[Showing lines 1–1000 of 1200.');
    expect(whole.content).not.toContain('row 1001');
    expect(tooMuch).toMatchObject({ isError: false });
    expect(tooMuch.content).toContain('startLine 1001');
    // What a UI gets, next to the text: the range this call covered.
    expect(range.artifacts).toEqual([
      {
        kind: 'file_read',
        path: 'big.txt',
        startLine: 10,
        endLine: 12,
        totalLines: 1200,
        whole: false,
      },
    ]);
    expect(whole.artifacts?.find(isFileRead)).toMatchObject({
      startLine: 1,
      endLine: 1000,
      whole: false,
    });
    expect((await read('index.ts')).artifacts).toEqual([
      { kind: 'file_read', path: 'index.ts', startLine: 1, endLine: 1, totalLines: 1, whole: true },
    ]);
  });

  it('fails open on a range past the end: an empty read with the file length, not an error', async () => {
    const result = await read('index.ts', { startLine: 99 });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain('The file has 1 lines; startLine 99 is past the end');
  });

  it('the guards still fail closed with a range: .env and outside paths are refused', async () => {
    expect(await read('.env', { startLine: 1, endLine: 1 })).toMatchObject({ isError: true });
    expect((await read('../outside.txt', { startLine: 1 })).content).toContain(
      'Path is outside the workspace',
    );
  });

  it('returns an error result for missing files', async () => {
    expect(await read('nope.ts')).toMatchObject({ isError: true });
  });

  it('refuses files outside the workspace', async () => {
    const result = await read('../outside.txt');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Path is outside the workspace');
    expect(result.content).not.toContain('outside secret');
  });
});

describe('read_file remembers what was read', () => {
  const MAIN = sessionIdSchema.parse('7d9a2c41-5e0b-4f63-8a17-3c6e9b1d4f20');
  const CHILD = sessionIdSchema.parse('1b8e4f02-9c3d-4a65-b7e1-6d2f0a9c5e38');
  const asSession = (id: typeof MAIN) => ({ id, rootId: MAIN, depth: 0 }) as unknown as SessionRef;
  const hasRead = (agentId: typeof MAIN, file: string) =>
    fileReads.current.hasRead({ agentId, file: path.join(workspace.root, file) });

  it('marks the file read for the agent that read it, by real path', async () => {
    expect(hasRead(MAIN, 'index.ts')).toBe(false);

    await read('index.ts', {}, asSession(MAIN));

    expect(hasRead(MAIN, 'index.ts')).toBe(true);
    // Another agent's view is its own.
    expect(hasRead(CHILD, 'index.ts')).toBe(false);
  });

  it('counts a range read, and a read through a symlink as the target', async () => {
    await symlink(path.join(root, 'index.ts'), path.join(root, 'alias.ts'));
    await read('alias.ts', { startLine: 1, endLine: 1 }, asSession(MAIN));

    expect(hasRead(MAIN, 'index.ts')).toBe(true);
  });

  it('marks nothing for a read that was refused or failed', async () => {
    for (const refused of ['.env', '../outside.txt', 'missing.ts', 'innocent.txt']) {
      expect((await read(refused, {}, asSession(MAIN))).isError, refused).toBe(true);
    }

    for (const file of ['.env', 'missing.ts']) expect(hasRead(MAIN, file), file).toBe(false);
  });

  it('without a session is the one agent there is', async () => {
    await read('index.ts');

    expect(
      fileReads.current.hasRead({
        agentId: agentIdFor('no-session'),
        file: path.join(workspace.root, 'index.ts'),
      }),
    ).toBe(true);
  });
});

describe('read_file .env guard', () => {
  it.each(['.env', '.env.local', 'nested/.env.production', './nested/../.env', '.ENV.LOCAL'])(
    'refuses %s',
    async (filePath) => {
      const result = await read(filePath);

      expect(result).toMatchObject({ isError: true });
      expect(result.content).toContain('Reading .env files is not allowed');
      expect(result.content).not.toContain('hunter2');
    },
  );

  it('refuses an absolute path to a .env file', async () => {
    expect((await read(path.join(root, '.env'))).content).toContain(
      'Reading .env files is not allowed',
    );
  });

  it('refuses a symlink that points at a .env file', async () => {
    const result = await read('innocent.txt');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Reading .env files is not allowed');
    expect(result.content).not.toContain('hunter2');
  });

  it("refuses .env files that don't exist, without revealing whether they do", async () => {
    expect((await read('.env.staging')).content).toContain('Reading .env files is not allowed');
  });
});

describe('isEnvFile', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    '.env.example',
    '.ENV',
    '/a/b/.env.test',
    '.env ',
    '.ENV ',
    '.env.local ',
    '.env.',
  ])('matches %s', (p) => {
    expect(isEnvFile(p)).toBe(true);
  });

  it.each(['env.ts', '.environment', 'src/.envy', 'dotenv.ts', 'my.env', 'env ', '.envrc '])(
    'does not match %s',
    (p) => {
      expect(isEnvFile(p)).toBe(false);
    },
  );
});
