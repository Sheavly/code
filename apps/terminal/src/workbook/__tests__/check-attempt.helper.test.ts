import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkWorkbook } from '../check.helper.js';
import { runWorkbook } from '../run.helper.js';
import { WorkbookStore } from '../store.service.js';
import { runIdSchema } from '../workbook.validator.js';

vi.mock('../run.helper.js', () => ({ runWorkbook: vi.fn() }));

let root = '';

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.mocked(runWorkbook).mockReset();
  if (root) await rm(root, { recursive: true, force: true });
});

async function storeForCheck() {
  root = await mkdtemp(path.join(tmpdir(), 'workbook-attempt-'));

  const store = new WorkbookStore(root);
  const step = { run: {}, expect: { reply: ['OK'] } };
  const check = {
    areas: ['apps/terminal/src/workbook'],
    steps: [{ ...step, forbid: { tools: ['run_command'] } }, step],
  };

  await mkdir(path.join(root, 'prompts'));
  await writeFile(
    path.join(root, 'prompts', 'fixture.md'),
    `---\ncheck: ${JSON.stringify(check)}\n---\nCheck the fixture`,
  );
  await writeFile(
    path.join(root, 'run-sources.json'),
    JSON.stringify({ include: ['apps/terminal/src/'], exclude: ['__tests__'] }),
  );

  return store;
}

describe('check attempt authorization and cleanup', () => {
  it('narrows no-command steps, forwards ordinary steps, and removes trust files on both attempts', async () => {
    vi.stubEnv('BACKEND_URL', '');

    const store = await storeForCheck();
    const trustFiles: string[] = [];
    const captured: (readonly string[])[] = [];

    vi.mocked(runWorkbook).mockImplementation(async (params) => {
      expect(params.checkContext).toBeDefined();
      expect(params.trustFile).toBeDefined();
      trustFiles.push(params.trustFile ?? '');
      captured.push(params.checkContext?.approvedCommands ?? []);
      await writeFile(params.trustFile ?? '', '{"fixture":true}');

      const paths = await store.beginRun({
        id: (number) => `${number.toString().padStart(4, '0')}-fixture`,
      });
      const result = {
        outcome: 'completed' as const,
        endedAt: 0,
        durationMs: 0,
        events: 0,
        modelCalls: 0,
        toolCalls: 0,
        toolErrors: 0,
        sessions: 1,
        messages: 1,
      };
      const meta = {
        id: paths.id,
        prompt: 'fixture',
        text: 'Check',
        startedAt: 0,
        adapter: 'fake',
        model: 'fake',
        workspace: store.runWorkspaceDir('fixture'),
        mainSession: 'main',
      };
      const reply = trustFiles.length === 1 ? 'missing marker' : 'OK';

      await Promise.all([
        writeFile(paths.meta, JSON.stringify(meta)),
        writeFile(paths.result, JSON.stringify(result)),
        writeFile(
          paths.messages,
          JSON.stringify([{ role: 'assistant', content: reply, toolCalls: [] }]),
        ),
        writeFile(paths.events, ''),
        writeFile(paths.transcript, ''),
      ]);

      return { ...result, id: paths.id };
    });

    const output: string[] = [];
    const ended = await checkWorkbook({
      store,
      names: ['fixture'],
      all: false,
      approvedCommands: ['node'],
      write: (text) => output.push(text),
    });

    expect(ended).toBe('passed');
    expect(captured).toEqual([[], ['node'], [], ['node']]);
    expect(new Set(trustFiles).size).toBe(2);
    expect(output.join('')).toContain('passed on retry');
    await Promise.all(
      trustFiles.map((file) =>
        expect(access(path.dirname(file))).rejects.toMatchObject({ code: 'ENOENT' }),
      ),
    );
  });

  it('removes attempt scratch when a run fails, without retrying an unknown backend failure', async () => {
    vi.stubEnv('BACKEND_URL', '');

    const store = await storeForCheck();
    let trustFile = '';

    vi.mocked(runWorkbook).mockImplementation(async (params) => {
      trustFile = params.trustFile ?? '';
      await writeFile(trustFile, '{"fixture":true}');
      throw new Error('backend failed');
    });

    await expect(
      checkWorkbook({
        store,
        names: ['fixture'],
        all: false,
        approvedCommands: ['node'],
        write: () => undefined,
      }),
    ).rejects.toThrow('backend failed');
    await expect(access(path.dirname(trustFile))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(runWorkbook).toHaveBeenCalledOnce();
  });

  it('ends as interrupted, neither passed nor failed, when Ctrl+C stops a run', async () => {
    vi.stubEnv('BACKEND_URL', '');

    const store = await storeForCheck();

    vi.mocked(runWorkbook).mockResolvedValue({
      outcome: 'interrupted',
      endedAt: 0,
      durationMs: 0,
      events: 0,
      modelCalls: 0,
      toolCalls: 0,
      toolErrors: 0,
      sessions: 1,
      messages: 0,
      id: runIdSchema.parse('0001-fixture'),
    });

    const ended = await checkWorkbook({
      store,
      names: ['fixture'],
      all: false,
      write: () => undefined,
    });

    expect(ended).toBe('interrupted');
    // No retry and no further step after a stopped run.
    expect(runWorkbook).toHaveBeenCalledOnce();
  });

  it('fails closed before reading prompts or calling a backend when externally attached', async () => {
    vi.stubEnv('BACKEND_URL', 'http://external.test');

    const store = await storeForCheck();
    const prompts = vi.spyOn(store, 'prompts');

    await expect(
      checkWorkbook({ store, names: ['fixture'], all: false, write: () => undefined }),
    ).rejects.toThrow(/own backend/);
    expect(prompts).not.toHaveBeenCalled();
    expect(runWorkbook).not.toHaveBeenCalled();
  });
});
