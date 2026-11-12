import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import {
  agentHistoryFile,
  conversationFolder,
  historyLogFile,
} from '../conversation-store.utils.js';

const ROOT = path.resolve(path.sep, 'data', 'conversations');
const ID = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';

describe('conversationFolder', () => {
  it('is the id inside the conversations folder', () => {
    expect(conversationFolder({ conversations: ROOT, id: ID })).toBe(path.join(ROOT, ID));
  });

  it.each([
    ['empty', ''],
    ['a parent folder', '..'],
    ['a path', '../x'],
    ['a path behind an id', `${ID}/../..`],
    ['a separator', `a${path.sep}b`],
    ['capitals', ID.toUpperCase()],
    ['a name', 'work'],
    ['a glob', '*'],
  ])('refuses %s, before it is a path', (_label, id) => {
    expect(() => conversationFolder({ conversations: ROOT, id })).toThrow(
      expect.objectContaining({ name: 'StoreError', reason: 'failed' }) as Error,
    );
  });
});

describe('agentHistoryFile', () => {
  const folder = path.join(ROOT, ID);

  it('is the session’s own file inside the conversation’s agents folder', () => {
    const session = '7d9a2c41-5e0b-4f63-8a17-3c6e9b1d4f20';

    expect(agentHistoryFile({ folder, session: sessionOf(session) })).toBe(
      path.join(folder, 'agents', `${session}.history.json`),
    );
  });

  it.each(['main', '../../x', '', 'a/b', '..'])('refuses %j, before it is a path', (session) => {
    expect(() => agentHistoryFile({ folder, session: sessionOf(session) })).toThrow(
      expect.objectContaining({ name: 'StoreError' }) as Error,
    );
  });
});

describe('historyLogFile', () => {
  const session = '7d9a2c41-5e0b-4f63-8a17-3c6e9b1d4f20';

  it('is the main session’s log, or a sub-agent’s inside the agents folder', () => {
    const folder = path.join(ROOT, ID);

    expect(historyLogFile({ folder, session: undefined })).toBe(path.join(folder, 'history.jsonl'));
    expect(historyLogFile({ folder, session: sessionOf(session) })).toBe(
      path.join(folder, 'agents', `${session}.history.jsonl`),
    );
  });

  it('does not rewrite a folder whose own name holds the legacy suffix', () => {
    const folder = path.join(ROOT, 'work.history.json', ID);

    expect(historyLogFile({ folder, session: sessionOf(session) })).toBe(
      path.join(folder, 'agents', `${session}.history.jsonl`),
    );
  });

  it.each(['main', '../../x', '', 'a/b', '..'])('refuses %j, before it is a path', (bad) => {
    expect(() => historyLogFile({ folder: ROOT, session: sessionOf(bad) })).toThrow(
      expect.objectContaining({ name: 'StoreError' }) as Error,
    );
  });
});

function sessionOf(value: string) {
  return sessionIdSchema.parse(value);
}
