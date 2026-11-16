import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { showRun, stepRun } from '../inspect.helper.js';
import { WorkbookStore } from '../store.service.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A run that was force-quit: its folder and transcript exist, but no run.json or result.json. */
async function forceQuitRun() {
  const root = await mkdtemp(path.join(tmpdir(), 'workbook-unfinished-'));

  roots.push(root);

  const store = new WorkbookStore(root);
  const paths = await store.beginRun({ id: (number) => `${number}-demo` });

  await writeFile(paths.transcript, '→ run 1-demo\n');

  return { store, id: paths.id };
}

describe('inspecting a force-quit run', () => {
  it('shows what exists and says it did not finish, instead of throwing', async () => {
    const { store, id } = await forceQuitRun();
    let shown = '';

    await showRun({ store, id, write: (text) => (shown += text) });
    expect(shown).toContain('no run.json');
    expect(shown).toContain('unfinished');
  });

  it('steps through it, with no events yet', async () => {
    const { store, id } = await forceQuitRun();
    let shown = '';

    await stepRun({ store, id, write: (text) => (shown += text) });
    expect(shown).toContain('0 steps');
  });
});
