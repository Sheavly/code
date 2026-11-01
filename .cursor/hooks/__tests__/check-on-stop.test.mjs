import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runHook } from './run-hook.utils.mjs';

let stateDir = '';
let project = '';

// Both hooks run in a throwaway project sharing one chat-state dir. With no node_modules there,
// every gate step fails fast, so a gate that runs always reports failures. `edit` stands for a
// Write or a Delete: the same hook handles both, and a deleted file is one that isn't there.
const stop = (chat, status = 'completed') =>
  runHook({
    script: 'check-on-stop.mjs',
    cwd: project,
    input: { conversation_id: chat, status },
    stateDir,
  });

const edit = (chat, file) =>
  runHook({
    script: 'lint-edited-file.mjs',
    cwd: project,
    input: { conversation_id: chat, tool_input: { path: file } },
    stateDir,
  });

beforeEach(() => {
  stateDir = mkdtempSync(path.join(os.tmpdir(), 'hook-state-'));
  project = mkdtempSync(path.join(os.tmpdir(), 'hook-project-'));
  mkdirSync(path.join(project, 'docs'));
  writeFileSync(path.join(project, 'docs/x.md'), '');
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe('the stop hook', () => {
  it('skips a chat that edited nothing in the checkout', () => {
    expect(stop('asker')).toEqual({});
  });

  it('skips a chat whose edits were outside the checkout (another worktree)', () => {
    edit('worktree', path.join(os.tmpdir(), 'elsewhere', 'a.ts'));

    expect(stop('worktree')).toEqual({});
  });

  it('runs the gate for a chat that edited project source', () => {
    edit('editor', 'docs/x.md');

    expect(stop('editor').followup_message).toContain('The quality gate fails');
  });

  it('runs the gate for a chat that deleted project source', () => {
    edit('deleter', 'src/gone.ts');

    expect(stop('deleter').followup_message).toContain('The quality gate fails');
  });

  it('checks only the chat that edited, not the others', () => {
    edit('editor', 'docs/x.md');

    expect(stop('asker')).toEqual({});
  });

  it('skips a turn that did not complete, even for a chat that edited', () => {
    edit('editor', 'docs/x.md');

    expect(stop('editor', 'aborted')).toEqual({});
  });
});
