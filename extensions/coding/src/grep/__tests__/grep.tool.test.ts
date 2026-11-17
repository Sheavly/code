import { symlink } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { testProcesses } from '@sheavly/process/testing/process-runner.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { MAX_GREP_RESULTS } from '../grep.constants.js';
import { createGrepTool } from '../grep.tool.js';
import { isGrepResult } from '../grep-format.utils.js';

const many = Array.from({ length: MAX_GREP_RESULTS + 50 }, (_, i) => `needle ${i}`).join('\n');
const temp = useTempWorkspace({
  prefix: 'grep-test-',
  files: {
    'a.ts': 'const needle = 1;\nconst other = 2;\nneedle again\n',
    'src/b.ts': 'export const needle = 2;\n',
    'src/c.md': 'a needle in markdown\n',
    '.env': 'needle=hunter2\n',
    '.env.local': 'needle=hunter2\n',
    'nested/.env.production': 'needle=hunter2\n',
    '.Env.local': 'needle=hunter2\n',
    'sub/.eNv': 'needle=hunter2\n',
    '.git/config': 'needle in git config\n',
    // A submodule's or worktree's `.git` is a file, not a folder.
    'module/.git': 'gitdir: needle-pointer\n',
    'odd/we:ird.txt': 'needle colon\n',
    'odd/new\nline.txt': 'needle newline\n',
    'many.txt': many,
  },
  outside: { 'outside.txt': 'needle outside\n' },
});
const processes = testProcesses();
const signal = new AbortController().signal;

beforeAll(async () => {
  await symlink(path.join(temp.root, '.env'), path.join(temp.root, 'link-to-env.txt'));
});

const grep = (input: Record<string, unknown>, abort: AbortSignal = signal) =>
  runTool({
    tools: [createGrepTool({ workspace: temp.workspace, processes })],
    call: {
      id: callIdSchema.parse('1'),
      name: 'grep',
      input: { description: 'searching', ...input },
    },
    signal: abort,
  });

describe('grep', () => {
  it('preserves the tool description and every input description', () => {
    const tool = createGrepTool({ workspace: temp.workspace, processes });

    expect(tool.description).toBe(
      'Search file contents with ripgrep (a regular expression). Searches the whole workspace, or ' +
        'the file or folder in path (relative to the workspace root). Respects .gitignore; .env files ' +
        'and .git are never searched. mode content (default) returns path:line:text, files only the ' +
        'paths that match, count the number of matching lines per file. glob limits which files are ' +
        `searched, e.g. "*.ts", and ignores case. At most ${MAX_GREP_RESULTS} results are returned and the output says ` +
        'when more were cut, so narrow the search instead of repeating it.',
    );
    expect(
      Object.fromEntries(
        Object.entries(tool.inputSchema.shape).map(([name, schema]) => [name, schema.description]),
      ),
    ).toEqual({
      pattern: 'Regular expression to search for (Rust regex syntax)',
      path: 'File or folder to search, relative to the workspace root (default: all of it)',
      glob: 'Only search files matching this glob, e.g. "*.ts"',
      mode: 'What to return (default content)',
      caseInsensitive: 'Ignore case (default: case-sensitive)',
    });
  });

  it('returns path:line:text for each match, sorted by path', async () => {
    const result = await grep({ pattern: 'needle', path: 'src' });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toBe(
      'src/b.ts:1:export const needle = 2;\nsrc/c.md:1:a needle in markdown',
    );
  });

  it('returns a typed artifact for the UI', async () => {
    const result = await grep({ pattern: 'needle', path: 'a.ts' });
    const artifact = result.artifacts?.find(isGrepResult);

    expect(artifact).toEqual({
      kind: 'grep_matches',
      pattern: 'needle',
      searched: 'a.ts',
      mode: 'content',
      truncated: false,
      skipped: '',
      matches: [
        { path: 'a.ts', line: 1, text: 'const needle = 1;' },
        { path: 'a.ts', line: 3, text: 'needle again' },
      ],
    });
  });

  it('files mode lists only the files that match', async () => {
    const result = await grep({ pattern: 'needle', mode: 'files', glob: '!{many.txt,odd/**}' });

    expect(result.content).toBe('a.ts\nsrc/b.ts\nsrc/c.md');
  });

  it('count mode gives the matching lines per file', async () => {
    const result = await grep({ pattern: 'needle', mode: 'count', path: 'src' });

    expect(result.content).toBe('src/b.ts:1\nsrc/c.md:1');
  });

  it('limits the files searched with a glob, and ignores case on request', async () => {
    expect((await grep({ pattern: 'needle', glob: '*.md' })).content).toBe(
      'src/c.md:1:a needle in markdown',
    );
    expect(
      (await grep({ pattern: 'NEEDLE', path: 'src/b.ts', caseInsensitive: true })).content,
    ).toContain('src/b.ts:1:');
    expect((await grep({ pattern: 'NEEDLE', path: 'src/b.ts' })).content).toContain('No matches');
  });

  it('says so when nothing matches', async () => {
    const result = await grep({ pattern: 'absent-pattern-xyz' });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toBe('No matches for absent-pattern-xyz in ..');
  });

  it('cuts at the result limit and says how to narrow the search', async () => {
    const result = await grep({ pattern: 'needle', path: 'many.txt' });
    const artifact = result.artifacts?.find(isGrepResult);

    expect(artifact).toMatchObject({ truncated: true });
    expect(artifact?.mode === 'content' && artifact.matches).toHaveLength(MAX_GREP_RESULTS);
    expect(result.content).toContain(`Showing the first ${MAX_GREP_RESULTS} results`);
    expect(result.content).toContain('Narrow the search');
  });

  it('keeps paths that hold a colon or a newline whole, in every mode', async () => {
    const content = await grep({ pattern: 'needle', path: 'odd' });
    const found = content.artifacts?.find(isGrepResult);
    const counts = await grep({ pattern: 'needle', path: 'odd', mode: 'count' });
    const files = await grep({ pattern: 'needle', path: 'odd', mode: 'files' });

    expect(found?.mode === 'content' && found.matches).toEqual([
      { path: 'odd/new\nline.txt', line: 1, text: 'needle newline' },
      { path: 'odd/we:ird.txt', line: 1, text: 'needle colon' },
    ]);
    expect(counts.content).toBe('odd/new\nline.txt:1\nodd/we:ird.txt:1');
    expect(files.content).toBe('odd/new\nline.txt\nodd/we:ird.txt');
  });

  it("fails with ripgrep's message on a bad regex", async () => {
    const result = await grep({ pattern: '(' });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('regex parse error');
  });
});

describe('grep guards', () => {
  it('never returns .env or .git content, even for a glob that asks for it', async () => {
    for (const input of [
      { pattern: 'needle' },
      { pattern: 'needle', glob: '.env*' },
      { pattern: 'needle', glob: '**/.env.production' },
      { pattern: 'needle', glob: '.git/**' },
      // A regex, so the "no matches" message can't echo the secret back.
      { pattern: 'hunt.r2', mode: 'files' },
    ]) {
      const result = await grep(input);

      expect(result.content, JSON.stringify(input)).not.toContain('hunter2');
      expect(result.content, JSON.stringify(input)).not.toContain('.env');
      expect(result.content, JSON.stringify(input)).not.toContain('git config');
    }
  });

  it('finds no case variant of .env in a directory walk, even when a glob asks for hidden files', async () => {
    for (const glob of ['.ENV*', '**/.eNv', '.Env.local', '*']) {
      const result = await grep({ pattern: 'hunt.r2', mode: 'files', glob });

      expect(result.content, glob).not.toContain('hunter2');
      expect(result.content, glob).not.toMatch(/\.env/i);
    }
  });

  it('never returns a .git file found in a walk, even when a glob asks for hidden files', async () => {
    for (const glob of ['.*', '**', 'module/.git']) {
      const result = await grep({ pattern: 'needle-pointer', mode: 'files', glob });

      expect(result.content, glob).not.toContain('.git');
    }
  });

  it('refuses a .git file as the path', async () => {
    const result = await grep({ pattern: 'needle', path: 'module/.git' });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Searching inside .git is not allowed');
  });

  it.each(['.git', '.git/config', 'sub/../.git/config', '.GIT/config'])(
    'refuses to search %s as the path',
    async (target) => {
      const result = await grep({ pattern: 'needle', path: target });

      expect(result).toMatchObject({ isError: true });
      expect(result.content).toContain('Searching inside .git is not allowed');
      expect(result.content).not.toContain('git config');
    },
  );

  it('does not follow a symlink that points at a .env file', async () => {
    const result = await grep({ pattern: 'needle', mode: 'files', glob: '!many.txt' });

    expect(result.content).not.toContain('link-to-env.txt');
  });

  it.each(['.env', '.env.local', 'nested/.env.production', './nested/../.env', '.ENV.LOCAL'])(
    'refuses to search %s by name',
    async (target) => {
      const result = await grep({ pattern: 'needle', path: target });

      expect(result).toMatchObject({ isError: true });
      expect(result.content).toContain('Searching .env files is not allowed');
    },
  );

  it('refuses a symlink path that points at a .env file', async () => {
    const result = await grep({ pattern: 'needle', path: 'link-to-env.txt' });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Searching .env files is not allowed');
    expect(result.content).not.toContain('hunter2');
  });

  it('refuses a path outside the workspace', async () => {
    for (const outside of ['../outside.txt', '..', path.join(temp.base, 'outside.txt')]) {
      const result = await grep({ pattern: 'needle', path: outside });

      expect(result, outside).toMatchObject({ isError: true });
      expect(result.content, outside).toContain('Path is outside the workspace');
      expect(result.content, outside).not.toContain('needle outside');
    }
  });

  it('reads a pattern that looks like a flag as a pattern', async () => {
    const result = await grep({ pattern: '--files' });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain('No matches');
  });

  it('is interrupted when the run aborts', async () => {
    const abort = new AbortController();

    abort.abort();

    expect(await grep({ pattern: 'needle' }, abort.signal)).toMatchObject({ isError: true });
  });
});
