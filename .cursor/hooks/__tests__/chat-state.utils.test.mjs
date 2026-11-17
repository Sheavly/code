import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  breakStaleLock,
  CHAT_STATE_VERSION,
  changeChatState,
  getChatState,
  keepShownInChat,
  listChatStates,
  MAX_AGE_MS,
  pruneChatStates,
  shownInChat,
  updateChatState,
} from '../chat-state.utils.mjs';
import { HookStateError } from '../hooks.errors.mjs';
import { hookNow } from '../hooks.utils.mjs';

const WRITER = fileURLToPath(new URL('chat-state-writer.fake.mjs', import.meta.url));
let stateDir = '';

beforeEach(() => {
  stateDir = mkdtempSync(path.join(os.tmpdir(), 'chat-state-'));
  process.env.SHEAVLY_HOOK_STATE_DIR = stateDir;
});

afterEach(() => {
  delete process.env.SHEAVLY_HOOK_STATE_DIR;
  rmSync(stateDir, { recursive: true, force: true });
});

/** Sets `file`'s modified time `ms` into the past. */
function makeOlder(params) {
  const { file, ms } = params;
  const seconds = (hookNow() - ms) / 1000;

  utimesSync(file, seconds, seconds);
}

const fileOf = (id) => path.join(stateDir, `${id}.json`);
const writeRaw = (id, content) => writeFileSync(fileOf(id), JSON.stringify(content));

describe('the chat state file', () => {
  it('is versioned on write and reads back without the version', () => {
    updateChatState({ conversationId: 'c1', issues: [279], noIssue: false });

    expect(JSON.parse(readFileSync(fileOf('c1'), 'utf8')).version).toBe(CHAT_STATE_VERSION);
    expect(getChatState('c1')).toEqual({ issues: [279], noIssue: false });
  });

  it('merges fields into what is recorded', () => {
    updateChatState({ conversationId: 'c1', issues: [1] });
    updateChatState({ conversationId: 'c1', noIssue: true });

    expect(getChatState('c1')).toEqual({ issues: [1], noIssue: true });
  });

  it('migrates a file from before versions, dropping fields it no longer knows', () => {
    writeRaw('old', { issues: [5], allowCherryPick: true, retiredField: 'x' });

    expect(getChatState('old')).toEqual({ issues: [5], allowCherryPick: true });

    updateChatState({ conversationId: 'old', noIssue: false });

    expect(JSON.parse(readFileSync(fileOf('old'), 'utf8'))).toEqual({
      version: CHAT_STATE_VERSION,
      issues: [5],
      allowCherryPick: true,
      noIssue: false,
    });
  });

  it('rejects an old-format file whose field has the wrong type, naming the field', () => {
    writeRaw('old', { issues: 'not a list' });

    expect(() => getChatState('old')).toThrow(HookStateError);
    expect(() => getChatState('old')).toThrow(/field "issues" has the wrong type/);
  });

  it('rejects a file of another version, naming both versions', () => {
    writeRaw('future', { version: CHAT_STATE_VERSION + 1, issues: [1] });

    expect(() => getChatState('future')).toThrow(/version 2, and these hooks read version 1/);
  });

  it('refuses to write a field the schema does not have or a value of the wrong type', () => {
    expect(() => updateChatState({ conversationId: 'c1', madeUp: 1 })).toThrow(
      /unknown field "madeUp"/,
    );
    expect(() => updateChatState({ conversationId: 'c1', lastActiveAt: 'now' })).toThrow(
      /field "lastActiveAt" has the wrong type/,
    );
    expect(existsSync(fileOf('c1'))).toBe(false);
  });

  it('does not take a name every object inherits for a field of the schema', () => {
    expect(() => updateChatState({ conversationId: 'c1', constructor: 1 })).toThrow(
      /unknown field "constructor"/,
    );
    expect(existsSync(fileOf('c1'))).toBe(false);
  });

  it('applies a change to the state as it is, with the lock held', () => {
    updateChatState({ conversationId: 'c1', issues: [1] });
    changeChatState({
      conversationId: 'c1',
      change: (current) => ({ issues: [...current.issues, 2] }),
    });

    expect(getChatState('c1')).toEqual({ issues: [1, 2] });
  });

  it('leaves a chat that cannot be read out of the list of chats', () => {
    updateChatState({ conversationId: 'ok', issues: [1] });
    writeFileSync(fileOf('broken'), '{ not json');

    expect(listChatStates().map(({ id }) => id)).toEqual(['ok']);
  });
});

describe('hooks writing the same chat at once', () => {
  const run = (field, value) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [WRITER, field, JSON.stringify(value), '15'], {
        env: { ...process.env, SHEAVLY_HOOK_STATE_DIR: stateDir },
      });
      let stderr = '';

      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
    });

  it('keep each other’s fields', async () => {
    const fields = {
      noIssue: true,
      allowCherryPick: true,
      parentConversationId: 'p',
      lastActiveAt: 1,
      subagentStartedAt: 2,
      subagentStoppedAt: 3,
    };

    await Promise.all(Object.entries(fields).map(([field, value]) => run(field, value)));

    expect(getChatState('c1')).toEqual(fields);
    expect(existsSync(`${fileOf('c1')}.lock`)).toBe(false);
  });

  it('each add to one list without losing the others’ entries', async () => {
    const values = ['a', 'b', 'c', 'd', 'e', 'f'];

    await Promise.all(values.map((value) => run('skillHintsShown', value)));

    expect(new Set(getChatState('c1').skillHintsShown)).toEqual(new Set(values));
  });

  it('take over the lock a crashed hook left behind', () => {
    writeFileSync(`${fileOf('c1')}.lock`, 'crashed');
    makeOlder({ file: `${fileOf('c1')}.lock`, ms: 60_000 });
    updateChatState({ conversationId: 'c1', noIssue: true });

    expect(getChatState('c1')).toEqual({ noIssue: true });
  });
});

describe('breaking a lock', () => {
  const lock = () => `${fileOf('c1')}.lock`;

  it('removes one that is stale', () => {
    writeFileSync(lock(), 'crashed');
    makeOlder({ file: lock(), ms: 60_000 });
    breakStaleLock(lock());

    expect(existsSync(lock())).toBe(false);
    expect(readdirSync(stateDir)).toEqual([]);
  });

  it('puts back one a hook has just taken, keeping its token', () => {
    writeFileSync(lock(), 'live');
    breakStaleLock(lock());

    expect(readFileSync(lock(), 'utf8')).toBe('live');
    expect(readdirSync(stateDir)).toEqual(['c1.json.lock']);
  });

  it('does nothing when another waiter broke it first', () => {
    expect(() => breakStaleLock(lock())).not.toThrow();
  });
});

describe('old chats', () => {
  it('are deleted when a new chat starts', () => {
    updateChatState({ conversationId: 'old', noIssue: true });
    makeOlder({ file: fileOf('old'), ms: MAX_AGE_MS + 60_000 });
    updateChatState({ conversationId: 'new', noIssue: true });

    expect(existsSync(fileOf('old'))).toBe(false);
    expect(existsSync(fileOf('new'))).toBe(true);
  });

  it('lose what a hook that crashed left, once it is old', () => {
    for (const name of ['c1.json.123.tmp', 'c1.json.lock.123.stale', 'c1.json.lock']) {
      writeFileSync(path.join(stateDir, name), 'x');
      makeOlder({ file: path.join(stateDir, name), ms: MAX_AGE_MS + 60_000 });
    }

    expect(pruneChatStates()).toBe(3);
    expect(readdirSync(stateDir)).toEqual([]);
  });

  it('leave a file this module did not write alone, however old', () => {
    writeFileSync(path.join(stateDir, 'notes.txt'), 'keep');
    makeOlder({ file: path.join(stateDir, 'notes.txt'), ms: MAX_AGE_MS + 60_000 });

    expect(pruneChatStates()).toBe(0);
    expect(existsSync(path.join(stateDir, 'notes.txt'))).toBe(true);
  });

  it('are deleted by age, and recent ones kept', () => {
    updateChatState({ conversationId: 'a', noIssue: true });

    expect(pruneChatStates({ now: hookNow(), maxAgeMs: MAX_AGE_MS })).toBe(0);
    expect(pruneChatStates({ now: hookNow() + MAX_AGE_MS + 60_000 })).toBe(1);
  });
});

describe('what a chat was shown', () => {
  it('accumulates without repeating', () => {
    keepShownInChat({ conversationId: 'c1', field: 'skillHintsShown', values: ['git'] });
    keepShownInChat({ conversationId: 'c1', field: 'skillHintsShown', values: ['git', 'sheavly'] });

    expect(shownInChat({ conversationId: 'c1', field: 'skillHintsShown' })).toEqual(
      new Set(['git', 'sheavly']),
    );
    expect(shownInChat({ conversationId: 'other', field: 'skillHintsShown' })).toEqual(new Set());
  });
});
