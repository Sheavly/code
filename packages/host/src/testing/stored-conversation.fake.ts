import type { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';

const MAIN = sessionIdSchema.parse('main');

/**
 * Test-only: writes the first stream entry of a stored conversation, its main session started in
 * `state`: `idle` for one that ended well (it takes the next prompt), `running` for one the
 * process left mid-run.
 */
export async function seedMainSession(params: {
  store: MemoryConversationStore;
  id: ConversationId;
  state: 'idle' | 'running';
}): Promise<void> {
  const { store, id, state } = params;

  await store.entries(id).append({
    seq: 0,
    at: 1,
    sessionId: MAIN,
    kind: 'update',
    update: {
      type: 'session_started',
      session: { id: MAIN, rootId: MAIN, depth: 1, title: 'Chat', state, startedAt: 1 },
    },
  });
}

/** Test-only: the `seq` of every record in conversation `id`'s main history log, in order. */
export async function loggedSeqs(params: {
  store: MemoryConversationStore;
  id: ConversationId;
}): Promise<number[]> {
  const seqs: number[] = [];

  for await (const record of params.store.history({ id: params.id }).read()) seqs.push(record.seq);

  return seqs;
}
