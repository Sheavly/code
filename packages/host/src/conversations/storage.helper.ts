import type { ConversationStore } from '@sheavly/core/store/store.types';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { StorageOf } from './conversations.types.js';
import type { ConversationKeeper } from './keeper.service.js';

/** What the app builds conversation `id` on so it is kept: its stream's store and its history. */
export function storageOf(params: {
  store: ConversationStore | undefined;
  keeper: ConversationKeeper | undefined;
  id: ConversationId;
}): StorageOf {
  const { store, keeper, id } = params;

  if (!keeper || !store) return {};

  return {
    storage: {
      entries: store.entries(id),
      shell: store.shell(id),
      outputs: store.outputs(id),
      keepHistory: (messages) => keeper.keepHistory(messages),
      keepAgentHistory: (agent) => keeper.keepAgentHistory(agent),
      logOf: ({ session, main }) => store.history({ id, session: main ? undefined : session }),
    },
  };
}
