import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatReport, judgeRun, touchesAreas } from '../check.utils.js';
import { runSourcesSchema } from '../check.validator.js';
import { appendToWorkspace, selectChecks } from '../check.helper.js';
import { WorkbookStore } from '../store.service.js';
import type { CheckOutcome, Observed } from '../check.types.js';
import type { StoredPrompt } from '../workbook.types.js';

const observed: Observed = {
  transcript: '＋ house-rules added context (59 chars)\n[AGENTS.md OK] The answer is 41. Sheavly\n',
  reply: '[AGENTS.md OK] The answer is 41. Sheavly',
  toolResults: {},
  toolErrors: {},
  events: ['context_added', 'tool_call_started', 'tool_result', 'done'],
  contextHooks: ['house-rules'],
  tools: ['read_file'],
  outcome: 'completed',
  adapter: 'openai',
};

describe('judgeRun', () => {
  it('does not confuse inherited object properties with recorded tool output or patterns', () => {
    expect(
      judgeRun({
        expectation: { expect: { toolErrors: { constructor: ['denied'] } } },
        observed,
      }),
    ).toEqual(['toolErrors.constructor lacks denied']);
  });

  it('rejects a denied secret-read attempt even when the runnable check succeeded', () => {
    const expectation = {
      expect: { toolResults: { run_command: ['INVOICE_CHECK_OK'] } },
      forbid: { toolErrors: { read_file: ['Reading .env files is not allowed'] } },
    };
    const checked = { ...observed, toolResults: { run_command: 'INVOICE_CHECK_OK' } };

    expect(judgeRun({ expectation, observed: checked })).toEqual([]);
    expect(
      judgeRun({
        expectation,
        observed: {
          ...checked,
          toolErrors: {
            read_file: 'Reading .env files is not allowed (.env). They contain secrets.',
          },
        },
      }),
    ).toEqual(['toolErrors.read_file has Reading .env files is not allowed']);
  });

  it('checks successful tool output without requiring it in the renderer or final reply', () => {
    const expectation = { expect: { toolResults: { run_command: ['INVOICE_CHECK_OK'] } } };

    expect(
      judgeRun({
        expectation,
        observed: { ...observed, toolResults: { run_command: 'INVOICE_CHECK_OK' } },
      }),
    ).toEqual([]);
    expect(judgeRun({ expectation, observed: { ...observed, reply: 'INVOICE_CHECK_OK' } })).toEqual(
      ['toolResults.run_command lacks INVOICE_CHECK_OK'],
    );
    expect(
      judgeRun({
        expectation: { forbid: { toolResults: { run_command: ['SECRET'] } } },
        observed: { ...observed, toolResults: { run_command: 'SECRET' } },
      }),
    ).toEqual(['toolResults.run_command has SECRET']);
    expect(
      judgeRun({
        expectation,
        observed: { ...observed, toolResults: { read_file: 'INVOICE_CHECK_OK' } },
      }),
    ).toEqual(['toolResults.run_command lacks INVOICE_CHECK_OK']);
  });

  it('checks the recorded adapter so a different transport cannot satisfy a protocol test', () => {
    const expectation = { expect: { adapter: 'azure-chat' } };

    expect(judgeRun({ expectation, observed })).toEqual(['adapter openai, expected azure-chat']);
    expect(judgeRun({ expectation, observed: { ...observed, adapter: 'azure-chat' } })).toEqual([]);
  });
  it('allows built-in context while forbidding context from an untrusted project hook', () => {
    const expectation = { forbid: { contextHooks: ['house-rules'] } };

    expect(
      judgeRun({ expectation, observed: { ...observed, contextHooks: ['agents-md', 'skills'] } }),
    ).toEqual([]);
    expect(judgeRun({ expectation, observed })).toEqual(['house-rules in contextHooks']);
  });

  it('requires the named project hook when the workspace is trusted', () => {
    const expectation = { expect: { contextHooks: ['house-rules'] } };

    expect(judgeRun({ expectation, observed })).toEqual([]);
    expect(
      judgeRun({ expectation, observed: { ...observed, contextHooks: ['agents-md', 'skills'] } }),
    ).toEqual(['no house-rules in contextHooks']);
  });

  it('passes a run that shows everything expected and nothing forbidden', () => {
    expect(
      judgeRun({
        expectation: {
          expect: {
            transcript: ['house-rules added context'],
            reply: ['[AGENTS.md OK]', '/Sheavly\\W*$/'],
            events: ['context_added'],
            tools: ['read_file'],
            outcome: 'completed',
          },
          forbid: { transcript: ['hooks not loaded'], tools: ['run_command'] },
        },
        observed,
      }),
    ).toEqual([]);
  });

  it('names each broken expectation', () => {
    expect(
      judgeRun({
        expectation: {
          expect: { reply: ['MARKER', '/^nope/'], events: ['hook_failed'], outcome: 'failed' },
          forbid: { transcript: ['house-rules'], tools: ['read_file'] },
        },
        observed,
      }),
    ).toEqual([
      'transcript has house-rules',
      'reply lacks MARKER',
      'reply lacks /^nope/',
      'no hook_failed in events',
      'read_file in tools',
      'outcome completed, expected failed',
    ]);
  });

  it('treats only /…/ as a regex, so brackets and dots in text match literally', () => {
    const run = { ...observed, reply: 'a.b [x]' };

    expect(judgeRun({ expectation: { expect: { reply: ['a.b', '[x]'] } }, observed: run })).toEqual(
      [],
    );
    expect(judgeRun({ expectation: { expect: { reply: ['/A\\.B/i'] } }, observed: run })).toEqual(
      [],
    );
  });
});

/** The real list, so these tests pin what the stop hook nudges for too. */
const sources = runSourcesSchema.parse(
  JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, '../../../../../workbook/run-sources.json'),
      'utf8',
    ),
  ),
);

describe('selectChecks', () => {
  const prompt = (name: string, areas?: string[]): StoredPrompt => ({
    name,
    text: 'x',
    ...(areas && { check: { areas, expect: { outcome: 'completed' as const } } }),
  });
  const prompts = [
    prompt('trust', ['src/runtime/trust', 'src/host']),
    prompt('tools', ['src/tools/read-file']),
    prompt('plain'),
  ];
  const names = (picked: { checks: StoredPrompt[] }) => picked.checks.map((p) => p.name);

  it('runs only the checks whose areas the branch changed, and lists uncovered source', () => {
    const picked = selectChecks({
      prompts,
      names: [],
      all: false,
      changed: [
        'src/runtime/trust/trust.service.ts',
        'packages/loop/src/x.ts',
        'packages/loop/src/__tests__/x.test.ts',
        'packages/core/src/hook/hook.utils.ts',
        'src/render/render.service.ts',
        'docs/hooks.md',
      ],
      sources,
    });

    expect(names(picked)).toEqual(['trust']);
    expect(picked.uncovered).toEqual([
      'packages/loop/src/x.ts',
      'packages/core/src/hook/hook.utils.ts',
    ]);
  });

  it('reports a name that matches no check, instead of passing with nothing run', () => {
    const picked = selectChecks({
      prompts,
      names: ['tools', 'trust-chnaged', 'plain'],
      all: false,
      changed: [],
      sources,
    });

    expect(names(picked)).toEqual(['tools']);
    expect(picked.unknown).toEqual(['trust-chnaged', 'plain']);
  });

  it('runs every check with --all, and the named ones when named', () => {
    expect(names(selectChecks({ prompts, names: [], all: true, changed: [], sources }))).toEqual([
      'trust',
      'tools',
    ]);
    expect(
      names(selectChecks({ prompts, names: ['tools'], all: false, changed: [], sources })),
    ).toEqual(['tools']);
  });

  it('matches an area as a path prefix, not a name prefix', () => {
    expect(touchesAreas({ areas: ['src/host'], files: ['src/host/host.service.ts'] })).toBe(true);
    expect(touchesAreas({ areas: ['src/host'], files: ['src/hosting/x.ts'] })).toBe(false);
  });
});

describe('appendToWorkspace', () => {
  let root = '';

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('appends inside the run workspace, and refuses .env, .git and escapes like the file tools', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'workbook-append-'));

    const store = new WorkbookStore(root);
    const prompt: StoredPrompt = { name: 'p', text: 'x' };
    const dir = store.runWorkspaceDir('p');
    const append = (file: string) =>
      appendToWorkspace({ store, prompt, append: { file, text: 'more\n' } });

    await mkdir(path.join(dir, '.git'), { recursive: true });
    await writeFile(path.join(dir, 'notes.md'), 'notes\n');
    await append('notes.md');

    expect(await readFile(path.join(dir, 'notes.md'), 'utf8')).toBe('notes\nmore\n');
    await expect(append('.env')).rejects.toThrow('Writing .env files is not allowed');
    await expect(append('.git/config')).rejects.toThrow('Writing inside .git is not allowed');
    await expect(append('../escape.md')).rejects.toThrow('outside the workspace');
  });
});

describe('formatReport', () => {
  const outcome = (prompt: string, status: CheckOutcome['status']): CheckOutcome => ({
    prompt,
    status,
    attempts: status === 'failed' ? [['reply lacks x'], ['reply lacks x']] : [[]],
    runs: ['0001-x'],
  });

  it('never says "passed" when a check was stopped', () => {
    const report = formatReport([outcome('a', 'passed'), outcome('b', 'interrupted')]);

    expect(report).toContain('⏹ b  interrupted');
    expect(report.split('\n').at(-1)).toBe('stopped (Ctrl+C) after 2 check(s): not a pass');
  });

  it('counts failures, and says all passed only when every one did', () => {
    const failing = formatReport([outcome('a', 'failed'), outcome('b', 'passed_on_retry')]);

    expect(failing).toContain('    try 2: reply lacks x');
    expect(failing).toContain('~ b  passed on retry');
    expect(failing).toMatch(/1 of 2 failed$/);
    expect(formatReport([outcome('a', 'passed'), outcome('b', 'passed_on_retry')])).toMatch(
      /all 2 passed$/,
    );
  });
});
