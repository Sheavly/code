import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONVERSATION } from '@sheavly/testing/store/store-contract.fake';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import {
  INCONSISTENT_SESSION_MESSAGE,
  RUN_OUTCOMES,
} from '@sheavly/protocol/status/status.constants';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { FileConversationStore } from '../conversation-store.service.js';

const temp = useTempFolder('session-state-restore-');

function openStore() {
  return new FileConversationStore({ folder: temp.path(), onProblem: () => undefined });
}

/** The stream file of the conversation, where a stored session update is one JSON line. */
const streamFile = () => path.join(temp.path(), 'conversations', CONVERSATION, 'stream.jsonl');

/** A conversation that ran and was closed on disk, ending the way `outcome` says. */
async function ranAndEnded(outcome: (typeof RUN_OUTCOMES)[number]) {
  const store = openStore();
  const sessions = new SessionRegistry({ store: store.entries(CONVERSATION) });
  const main = sessions.startMain({ title: 'Chat' });

  sessions.end({ id: main.id, state: outcome });
  await sessions.flushStore();

  return { main, next: (await SessionRegistry.readStoredLog(store.entries(CONVERSATION))).next };
}

describe('restoring a conversation’s sessions from disk', () => {
  it.each(RUN_OUTCOMES)(
    'brings back a conversation that ended %s idle, with an outcome and no end time',
    async (outcome) => {
      const { main } = await ranAndEnded(outcome);
      const store = openStore();
      const resume = await SessionRegistry.readStoredLog(store.entries(CONVERSATION));
      const back = new SessionRegistry({ store: store.entries(CONVERSATION), resume });

      expect(back.get(main.id)).toMatchObject({ state: 'idle', lastOutcome: outcome });
      expect(back.get(main.id)?.endedAt).toBeUndefined();
      // Restoring writes its own idle update: let it land, then read the file again, so what the
      // restore wrote is held to the same schema as what it read.
      await back.flushStore();
      await expect(
        SessionRegistry.readStoredLog(openStore().entries(CONVERSATION)),
      ).resolves.toMatchObject({ sessions: [expect.objectContaining({ state: 'idle' })] });
    },
  );

  it('refuses a stored update whose session contradicts itself, instead of restoring it', async () => {
    const { main, next } = await ranAndEnded('completed');
    const contradicting = {
      seq: next,
      sessionId: main.id,
      at: 1,
      kind: 'update',
      update: {
        type: 'session_ended',
        session: {
          id: main.id,
          rootId: main.id,
          depth: 1,
          title: 'Chat',
          state: 'failed',
          lastOutcome: 'completed',
          startedAt: 0,
          endedAt: 2,
        },
      },
    };

    await appendFile(streamFile(), `${JSON.stringify(contradicting)}\n`);

    // Refused for the contradiction, not for a malformed line: the fixture is the same shape the
    // next test reads, and the message names the check.
    await expect(
      SessionRegistry.readStoredLog(openStore().entries(CONVERSATION)),
    ).rejects.toMatchObject({
      name: 'StoreError',
      message: expect.stringContaining(INCONSISTENT_SESSION_MESSAGE) as string,
    });
  });

  it('still reads a session stored without a last outcome or an end time', async () => {
    const { main, next } = await ranAndEnded('completed');
    const older = {
      seq: next,
      sessionId: main.id,
      at: 1,
      kind: 'update',
      update: {
        type: 'session_idle',
        session: {
          id: main.id,
          rootId: main.id,
          depth: 1,
          title: 'Chat',
          state: 'idle',
          startedAt: 0,
        },
      },
    };

    await appendFile(streamFile(), `${JSON.stringify(older)}\n`);

    const resume = await SessionRegistry.readStoredLog(openStore().entries(CONVERSATION));

    expect(resume.sessions.find((session) => session.id === main.id)).toMatchObject({
      state: 'idle',
    });
  });
});
