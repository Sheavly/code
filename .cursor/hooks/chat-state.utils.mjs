// Per-chat state the hooks share (the chat's issue, its edited files, what it was shown), kept
// outside the repo so it is never committed, one JSON file per chat. This module is the only
// reader and writer of those files:
//
// - SCHEMA names every field and what it holds. A write of an unknown field or a wrong type
//   throws; a file that breaks the schema is a `HookStateError` naming the field. The hooks run
//   before `npm ci` (guards), so the schema is plain functions, not a library.
// - Files carry a `version`. One from before versions (no `version`) is read as version 1 if it
//   passes the schema, and stamped on its next write; any other version is rejected.
// - Parallel hooks write the same chat, so a write takes a lock, re-reads, merges its fields and
//   replaces the file atomically (a temp file renamed over it): a reader never sees half a file,
//   and two hooks setting different fields keep both.
// - A chat's state expires: a file untouched for `MAX_AGE_MS` is deleted when a new chat starts.
//
// SHEAVLY_HOOK_STATE_DIR points tests at a temp dir.
import { randomUUID } from 'node:crypto';
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HookStateError, isMissingPath } from './hooks.errors.mjs';
import { hookNow } from './hooks.utils.mjs';

/** The format `updateChatState` writes. Bump it with a migration when a field's meaning changes. */
export const CHAT_STATE_VERSION = 1;

/** How long a chat's state file may sit untouched before a new chat's first write deletes it. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 5;

const isString = (value) => typeof value === 'string';
const isNumber = (value) => Number.isFinite(value);
const isBoolean = (value) => typeof value === 'boolean';
const isIssue = (value) => isString(value) || Number.isInteger(value);
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const arrayOf = (item) => (value) => Array.isArray(value) && value.every(item);
const recordOf = (item) => (value) => isObject(value) && Object.values(value).every(item);

/** Every field a chat's state may hold, with the check its value must pass. */
const SCHEMA = {
  // The chat's issues, and whether it opted out of one or approved cherry-picking.
  issues: arrayOf(isIssue),
  noIssue: isBoolean,
  allowCherryPick: isBoolean,
  // The links between a chat and its subagents, and their timing.
  parentConversationId: isString,
  lastActiveAt: isNumber,
  subagentStartedAt: isNumber,
  subagentStoppedAt: isNumber,
  subagentSupersededAt: isNumber,
  subagentDroppedAt: isNumber,
  // The files the chat edited (project-relative path to time), and what its shell commands did.
  editedProjectSource: isBoolean,
  editedFiles: recordOf(isNumber),
  editedFilesComplete: isBoolean,
  toolEditedFiles: recordOf(isNumber),
  shellSnapshots: recordOf(isObject),
  unguardedCommands: arrayOf(isObject),
  verifiedFormatterWrites: arrayOf(isObject),
  // Once-per-chat notes already shown.
  architectureRuleShown: isBoolean,
  whereCodeGoesShown: isBoolean,
  skillHintsShown: arrayOf(isString),
  workspaceReadmesShown: arrayOf(isString),
};

function stateDir() {
  return (
    process.env.SHEAVLY_HOOK_STATE_DIR ??
    path.join(os.homedir(), '.cache', 'sheavly-harness', 'chats')
  );
}

function chatStateFile(conversationId) {
  return path.join(stateDir(), `${String(conversationId).replace(/[^\w-]/g, '_')}.json`);
}

/** The first field of `fields` that is not in the schema or has the wrong type, or null. */
function schemaProblem(fields) {
  for (const [name, value] of Object.entries(fields)) {
    if (!Object.hasOwn(SCHEMA, name)) return `unknown field "${name}"`;
    if (!SCHEMA[name](value)) return `field "${name}" has the wrong type`;
  }

  return null;
}

/** The fields in `file`'s parsed content, or a `HookStateError` saying why it is not usable. */
function validatedFields(params) {
  const { file, content } = params;

  if (!isObject(content)) throw new HookStateError({ file, cause: 'it is not a JSON object' });

  const { version = CHAT_STATE_VERSION, ...fields } = content;

  if (version !== CHAT_STATE_VERSION) {
    throw new HookStateError({
      file,
      cause: `it is version ${version}, and these hooks read version ${CHAT_STATE_VERSION}`,
    });
  }

  // A field this version doesn't know is dropped, never trusted: an older format may carry one.
  const known = Object.fromEntries(
    Object.entries(fields).filter(([name]) => Object.hasOwn(SCHEMA, name)),
  );
  const problem = schemaProblem(known);

  if (problem) throw new HookStateError({ file, cause: problem });

  return known;
}

function readFields(file) {
  let text;

  try {
    text = readFileSync(file, 'utf8');
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return null; // a new chat: nothing recorded yet
    throw new HookStateError({ file, cause: caughtError });
  }

  try {
    return validatedFields({ file, content: JSON.parse(text) });
  } catch (caughtError) {
    if (caughtError instanceof HookStateError) throw caughtError;
    throw new HookStateError({ file, cause: caughtError });
  }
}

/** What earlier hooks recorded for this chat, or null when nothing was recorded yet. */
export function getChatState(conversationId) {
  if (!conversationId) return null;

  return readFields(chatStateFile(conversationId));
}

/** Blocks for `ms` without spinning: hooks are synchronous scripts with nothing else to run. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// A lock wait is timed on the process's monotonic clock, not `hookNow()`: tests freeze that one,
// and a frozen clock would make a waiting hook wait forever.
const monotonicMs = () => Number(process.hrtime.bigint() / 1_000_000n);

/** Whether `lock`, a file held by another hook, is old enough to be one that crashed. */
function isStale(lock) {
  try {
    return hookNow() - statSync(lock).mtimeMs > LOCK_STALE_MS;
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return false; // released while we looked
    throw caughtError;
  }
}

/**
 * Removes a lock a crashed hook left; exported for the lock tests. The lock is first renamed away,
 * which only one waiter can do, and judged again there: a waiter that checked earlier may have
 * moved a live lock a hook has just taken. That one goes back with a hard link, which fails rather
 * than replace a lock a third hook took in between. A holder whose lock is lost this way (it ran
 * past `LOCK_STALE_MS`) loses exclusivity only for that write, and its release no longer removes a
 * lock that is not its own.
 */
export function breakStaleLock(lock) {
  const claimed = `${lock}.${process.pid}.stale`;

  try {
    renameSync(lock, claimed);
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return; // another waiter broke it first
    throw caughtError;
  }

  if (!isStale(claimed)) {
    try {
      linkSync(claimed, lock);
    } catch (caughtError) {
      if (caughtError?.code !== 'EEXIST') throw caughtError; // a third hook holds it now
    }
  }

  rmSync(claimed, { force: true });
}

/** Takes `lock` for the caller's `token`; false when another hook holds it. */
function tryLock(params) {
  const { lock, token } = params;

  try {
    writeFileSync(lock, token, { flag: 'wx', mode: 0o600 });

    return true;
  } catch (caughtError) {
    if (caughtError?.code === 'EEXIST') return false;
    throw caughtError;
  }
}

/** Removes `lock` only if it is still the caller's: a lock broken as stale may be another hook's. */
function releaseLock(params) {
  const { lock, token } = params;

  try {
    if (readFileSync(lock, 'utf8') === token) rmSync(lock, { force: true });
  } catch (caughtError) {
    if (!isMissingPath(caughtError)) throw caughtError;
  }
}

/** Runs `write` holding `file`'s lock (a file beside it, which only one hook can create). */
function withLock(params) {
  const { file, write } = params;
  const lock = `${file}.lock`;
  const token = `${process.pid}.${randomUUID()}`;
  const deadline = monotonicMs() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      if (tryLock({ lock, token })) break;
    } catch (caughtError) {
      throw new HookStateError({ file, cause: caughtError });
    }

    if (isStale(lock)) breakStaleLock(lock);
    else if (monotonicMs() > deadline) {
      throw new HookStateError({ file, cause: `another hook holds its lock (${lock})` });
    } else sleep(LOCK_RETRY_MS);
  }

  try {
    return write();
  } finally {
    releaseLock({ lock, token });
  }
}

function replaceFile(params) {
  const { file, fields } = params;
  const temporary = `${file}.${process.pid}.tmp`;

  writeFileSync(temporary, JSON.stringify({ version: CHAT_STATE_VERSION, ...fields }), {
    mode: 0o600,
  });
  renameSync(temporary, file);
}

/**
 * Changes this chat's recorded state: `change` receives the state as it is while the lock is held
 * (`{}` for a new chat) and returns the fields to merge into it. A read-modify-write of one field
 * (a list, a map of entries) belongs here, not in a `getChatState` and `updateChatState` pair that
 * another hook can interleave with. A no-op without a `conversationId`. Throws a `HookStateError`
 * for a field the schema doesn't have or a value of the wrong type, and when the recorded state is
 * unusable. A new chat's first write also deletes the state of chats gone stale.
 */
export function changeChatState(params) {
  const { conversationId, change } = params;

  if (!conversationId) return;

  const file = chatStateFile(conversationId);

  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  withLock({
    file,
    write: () => {
      const current = readFields(file);
      const fields = change(current ?? {});
      const problem = schemaProblem(fields);

      if (problem) throw new HookStateError({ file, cause: `refused to write: ${problem}` });

      if (!current) pruneChatStatesQuietly();
      replaceFile({ file, fields: { ...current, ...fields } });
    },
  });
}

/** Merges `fields` into this chat's recorded state; see `changeChatState` for what it throws. */
export function updateChatState(params) {
  const { conversationId, ...fields } = params;

  changeChatState({ conversationId, change: () => fields });
}

// Only files this module wrote: `<chat id>.json`, its lock, and what a hook that crashed left (a
// temp file, a lock it was breaking).
const STATE_FILE = /^[\w-]+\.json(\.lock(\.\d+\.stale)?|\.\d+\.tmp)?$/;

/**
 * Deletes the state files untouched for `maxAgeMs`, and the leftovers of a hook that crashed.
 * Returns the number removed. A file that vanishes meanwhile, as another hook prunes too, is fine.
 */
export function pruneChatStates(params = {}) {
  const { now = hookNow(), maxAgeMs = MAX_AGE_MS } = params;
  let removed = 0;

  for (const name of readdirSync(stateDir()).filter((entry) => STATE_FILE.test(entry))) {
    const file = path.join(stateDir(), name);

    try {
      if (now - lstatSync(file).mtimeMs <= maxAgeMs) continue;
      rmSync(file);
      removed += 1;
    } catch (caughtError) {
      if (!isMissingPath(caughtError)) throw caughtError;
    }
  }

  return removed;
}

/** Cleanup must not stop a chat from recording its state: a folder it can't clean waits a write. */
function pruneChatStatesQuietly() {
  try {
    pruneChatStates();
  } catch (caughtError) {
    if (!caughtError?.code) throw caughtError; // only a file system error is let go
  }
}

/**
 * Every chat's recorded state as `{ id, state }`, `id` its state file's name. A state that can't
 * be read is left out, never thrown: it is that chat's to report, and leaving it out only means
 * its edits and links are not seen (as if it had recorded none).
 */
export function listChatStates() {
  let names;

  try {
    names = readdirSync(stateDir()).filter((name) => name.endsWith('.json'));
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return []; // no chat has recorded anything yet
    throw caughtError;
  }

  return names.flatMap((name) => {
    try {
      const state = readFields(path.join(stateDir(), name));

      return state ? [{ id: name.slice(0, -'.json'.length), state }] : [];
    } catch (caughtError) {
      if (caughtError instanceof HookStateError) return [];
      throw caughtError;
    }
  });
}

/** The id `conversationId`'s state is stored under, as `listChatStates` names it. */
export function chatStateId(conversationId) {
  return path.basename(chatStateFile(conversationId), '.json');
}

/** What this chat was already shown under `field` (a list field of the schema), as a set. */
export function shownInChat(params) {
  const { conversationId, field } = params;

  return new Set(getChatState(conversationId)?.[field] ?? []);
}

/** Records `values` as shown to this chat under `field`, keeping what was shown before. */
export function keepShownInChat(params) {
  const { conversationId, field, values } = params;

  changeChatState({
    conversationId,
    change: (current) => ({ [field]: [...new Set([...(current[field] ?? []), ...values])] }),
  });
}
