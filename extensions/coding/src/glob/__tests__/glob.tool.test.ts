import { symlink, utimes } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { testProcesses } from '@sheavly/process/testing/process-runner.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { MAX_GLOB_RESULTS, MAX_GLOB_SCANNED } from '../glob.constants.js';
import { createGlobTool } from '../glob.tool.js';
import { isGlobResult } from '../glob-format.utils.js';

const many = Object.fromEntries(
  Array.from({ length: MAX_GLOB_RESULTS + 50 }, (_, i) => [`many/f${i}.txt`, 'x']),
);
const temp = useTempWorkspace({
  prefix: 'glob-test-',
  files: {
    'src/old.ts': 'old',
    'src/mid.ts': 'mid',
    'src/new.ts': 'new',
    'src/readme.md': 'doc',
    '.env': 'SECRET=1',
    '.env.local': 'SECRET=1',
    'nested/.env.production': 'SECRET=1',
    '.git/config': 'git',
    ...many,
  },
  outside: { 'outside.ts': 'outside' },
});
const processes = testProcesses();
const signal = new AbortController().signal;

beforeAll(async () => {
  const at = (file: string, seconds: number) =>
    utimes(path.join(temp.root, file), seconds, seconds);

  await at('src/old.ts', 1_000_000);
  await at('src/mid.ts', 2_000_000);
  await at('src/new.ts', 3_000_000);
  await symlink(path.join(temp.root, '.env'), path.join(temp.root, 'src/link.ts'));
});

const glob = (input: Record<string, unknown>, abort: AbortSignal = signal) =>
  runTool({
    tools: [createGlobTool({ workspace: temp.workspace, processes })],
    call: {
      id: callIdSchema.parse('1'),
      name: 'glob',
      input: { description: 'finding files', ...input },
    },
    signal: abort,
  });

describe('glob', () => {
  it('preserves the tool description and every input description', () => {
    const tool = createGlobTool({ workspace: temp.workspace, processes });

    expect(tool.description).toBe(
      'Find files by name pattern, newest first. pattern is a glob such as "*.ts" or ' +
        '"src/**/*.test.ts" (case-insensitive). Searches the whole workspace, or the folder in path ' +
        '(relative to the workspace root). Respects .gitignore; .env files and .git are never listed. ' +
        `At most ${MAX_GLOB_RESULTS} files are returned and the output says when more were cut, so ` +
        `narrow the pattern instead of repeating it. A pattern matching over ${MAX_GLOB_SCANNED} files ` +
        'is only sorted among the first ones found, so narrow it for a reliable newest-first.',
    );
    expect(
      Object.fromEntries(
        Object.entries(tool.inputSchema.shape).map(([name, schema]) => [name, schema.description]),
      ),
    ).toEqual({
      pattern: 'Glob to match file paths against, e.g. "**/*.ts"',
      path: 'Folder to search, relative to the workspace root (default: all of it)',
    });
  });

  it('lists matching files newest first', async () => {
    const result = await glob({ pattern: '*.ts', path: 'src' });

    expect(result).toMatchObject({ isError: false });
    expect(result.content.split('\n').slice(0, 3)).toEqual([
      'src/new.ts',
      'src/mid.ts',
      'src/old.ts',
    ]);
  });

  it('returns a typed artifact for the UI', async () => {
    const result = await glob({ pattern: '*.md', path: 'src' });

    expect(result.artifacts?.find(isGlobResult)).toEqual({
      kind: 'glob_files',
      pattern: '*.md',
      searched: 'src',
      files: ['src/readme.md'],
      truncated: false,
      skipped: '',
    });
  });

  it('cuts the list and says so', async () => {
    const result = await glob({ pattern: '*.txt', path: 'many' });
    const artifact = result.artifacts?.find(isGlobResult);

    expect(artifact?.files).toHaveLength(MAX_GLOB_RESULTS);
    expect(artifact?.truncated).toBe(true);
    expect(result.content).toContain('there are more');
  });

  it('never lists .env files, .git or a symlink to a .env file', async () => {
    const result = await glob({ pattern: '**/*' });

    expect(result.content).not.toMatch(/\.env/);
    expect(result.content).not.toContain('.git/');
    expect(result.content).not.toContain('link.ts');
  });

  it.each(['.env', 'nested/.env.production', '.git', 'src/link.ts'])(
    'refuses %s as the path',
    async (target) => {
      const result = await glob({ pattern: '*', path: target });

      expect(result).toMatchObject({ isError: true });
      expect(result.content).not.toContain('SECRET');
    },
  );

  it('refuses a path outside the workspace', async () => {
    const result = await glob({ pattern: '*.ts', path: '..' });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Path is outside the workspace');
    expect(result.content).not.toContain('outside.ts');
  });

  it('reads a pattern that looks like a flag as a pattern', async () => {
    const result = await glob({ pattern: '--files' });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain('No files match');
  });

  it('says when nothing matches', async () => {
    const result = await glob({ pattern: '*.nope' });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain('No files match');
  });

  it('is interrupted when the run aborts', async () => {
    const abort = new AbortController();

    abort.abort();

    expect(await glob({ pattern: '*.ts' }, abort.signal)).toMatchObject({ isError: true });
  });
});
