import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Workspace } from '../../../runtime/workspace/workspace.service.js';
import { runTool } from '@sheavly/core/tool/tool.service';
import { createReadFileTool } from '../read-file.tool.js';
import { isEnvFile } from '../../files/files.utils.js';

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

const read = (filePath: string) =>
  runTool({
    tools: [createReadFileTool({ workspace })],
    call: {
      id: '1',
      name: 'read_file',
      input: { description: `reading ${filePath}`, path: filePath },
    },
    signal,
  });

describe('read_file', () => {
  it('reads a file inside the workspace', async () => {
    expect(await read('index.ts')).toMatchObject({
      isError: false,
      content: 'export const answer = 42;\n',
    });
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
  it.each(['.env', '.env.local', '.env.production', '.env.example', '.ENV', '/a/b/.env.test'])(
    'matches %s',
    (p) => {
      expect(isEnvFile(p)).toBe(true);
    },
  );

  it.each(['env.ts', '.environment', 'src/.envy', 'dotenv.ts', 'my.env'])(
    'does not match %s',
    (p) => {
      expect(isEnvFile(p)).toBe(false);
    },
  );
});
