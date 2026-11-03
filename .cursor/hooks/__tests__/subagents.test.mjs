// Subagents in the shape Cursor sends them (as Citylytics probed live): subagentStart's
// `subagent_id` is the parent's Task tool-call id, which the subagent's own hooks carry as
// `parent_tool_call_id`. The parent's stop hook waits while one works, then checks its edits; the
// git guard holds a subagent to its parent's issues.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runHook, runStopHook } from './run-hook.utils.mjs';

let stateDir = '';
let project = '';

const readState = (id) => JSON.parse(readFileSync(path.join(stateDir, `${id}.json`), 'utf8'));
const writeState = (id, state) => {
  writeFileSync(path.join(stateDir, `${id}.json`), JSON.stringify(state));
};

const start = (input) => runHook({ script: 'record-subagent.mjs', cwd: project, input, stateDir });
const stopSubagent = (input) =>
  runHook({ script: 'record-subagent-stop.mjs', cwd: project, input, stateDir });
const stopChat = (chat) => runStopHook({ cwd: project, chat, stateDir });

/** The parent starts a subagent on Task call `call`; the subagent (`sub`) then edits `file`. */
function subagentEdits(params) {
  const { parent = 'parent', call = 'tooluse_1', sub = 'sub', file = 'docs/x.md' } = params;

  start({ conversation_id: parent, subagent_id: call, parent_conversation_id: parent });
  runHook({
    script: 'lint-edited-file.mjs',
    cwd: project,
    input: { conversation_id: sub, parent_tool_call_id: call, tool_input: { path: file } },
    stateDir,
  });
}

beforeEach(() => {
  stateDir = mkdtempSync(path.join(os.tmpdir(), 'subagent-state-'));
  project = mkdtempSync(path.join(os.tmpdir(), 'subagent-project-'));
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ workspaces: [] }));
  writeFileSync(path.join(project, 'x.md'), '');
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe('subagentStart', () => {
  it('links the Task call to the chat that made it, and a subagent to its call', () => {
    expect(
      start({ conversation_id: 'p', subagent_id: 'call', parent_conversation_id: 'p' }),
    ).toEqual({ permission: 'allow' });
    subagentEdits({ parent: 'p', call: 'call', sub: 's' });

    expect(readState('call')).toMatchObject({ parentConversationId: 'p' });
    expect(readState('s')).toMatchObject({ parentConversationId: 'call' });
  });

  it('refuses a subagent it could not tie to a chat, and records nothing', () => {
    expect(start({ subagent_id: 'call' })).toMatchObject({ permission: 'deny' });
    expect(() => readState('call')).toThrow();
  });
});

describe("the parent's stop hook", () => {
  it('waits while a subagent works, then checks what it edited', () => {
    subagentEdits({});

    expect(stopChat('parent')).toEqual({});

    stopSubagent({ subagent_id: 'tooluse_1' });

    expect(stopChat('parent').followup_message).toContain('The quality gate fails');
  });

  it('matches a stop without a known call through the transcript of the subagent', () => {
    subagentEdits({});
    stopSubagent({ agent_transcript_path: '/tmp/transcripts/sub.jsonl' });

    expect(readState('tooluse_1').subagentStoppedAt).toEqual(expect.any(Number));
  });

  it('stops waiting for a silent subagent past the timeout, and names it once', () => {
    subagentEdits({});
    writeState('tooluse_1', { ...readState('tooluse_1'), subagentStartedAt: 1 });
    writeState('sub', { ...readState('sub'), lastActiveAt: 1, editedFiles: { 'docs/x.md': 1 } });

    expect(stopChat('parent').followup_message).toContain('Subagents tooluse_1 started');
    expect(stopChat('parent').followup_message ?? '').not.toContain('Subagents tooluse_1');
  });

  it("leaves another chat's subagents alone", () => {
    subagentEdits({ parent: 'other' });

    expect(stopChat('parent')).toEqual({});
  });
});

describe('a subagent and the git guard', () => {
  it("answers to its parent's issue", () => {
    writeState('parent', { issues: [42] });
    start({ conversation_id: 'parent', subagent_id: 'call', parent_conversation_id: 'parent' });
    const guard = (name) =>
      runHook({
        script: 'guard-git-workflow.mjs',
        cwd: project,
        input: {
          conversation_id: 'sub',
          parent_tool_call_id: 'call',
          command: `git switch -c ${name}`,
        },
        stateDir,
      });

    expect(guard('42-add-export').permission).toBe('allow');
    expect(guard('7-other-work').permission).toBe('deny');
  });
});
