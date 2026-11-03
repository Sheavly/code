import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runEditHook, runStopHook } from './run-hook.utils.mjs';

let stateDir = '';
let project = '';

// Both hooks run in a throwaway project sharing one chat-state dir. With no node_modules there,
// every gate step fails fast, so a gate that runs always reports failures. `edit` stands for a
// Write or a Delete: the same hook handles both, and a deleted file is one that isn't there.
const stop = (chat, status) => runStopHook({ cwd: project, chat, status, stateDir });
const edit = (chat, file) => runEditHook({ cwd: project, file, chat, stateDir });

beforeEach(() => {
  stateDir = mkdtempSync(path.join(os.tmpdir(), 'hook-state-'));
  project = mkdtempSync(path.join(os.tmpdir(), 'hook-project-'));
  mkdirSync(path.join(project, 'docs'));
  writeFileSync(path.join(project, 'docs/x.md'), '');
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ workspaces: [] }));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe('the stop hook', () => {
  it('names a corrupt chat state file instead of crashing or skipping silently', () => {
    writeFileSync(path.join(stateDir, 'corrupt.json'), '{ not json');

    expect(stop('corrupt').followup_message).toMatch(
      /^The stop hook could not run the quality gate: Chat state .*corrupt\.json could not be read/,
    );
  });

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

  it('runs the layout check with the rest of the gate', () => {
    edit('editor', 'docs/x.md');

    expect(stop('editor').followup_message).toContain('## Layout');
  });

  it('runs the gate for a chat that deleted project source', () => {
    edit('deleter', 'src/gone.ts');

    expect(stop('deleter').followup_message).toContain('The quality gate fails');
  });

  it('checks only the chat that edited, not the others', () => {
    edit('editor', 'docs/x.md');

    expect(stop('asker')).toEqual({});
  });

  it("tells a chat its report is scoped to its own edits, not other chats' work", () => {
    edit('editor', 'docs/x.md');

    expect(stop('editor').followup_message).toContain(
      'Only problems in the files this chat and its subagents edited',
    );
  });

  it('skips a turn that did not complete, even for a chat that edited', () => {
    edit('editor', 'docs/x.md');

    expect(stop('editor', 'aborted')).toEqual({});
  });
});
