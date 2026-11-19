import type { ClientHistoryMessage } from '@sheavly/protocol/history/history.types';
import type { ModelMode } from '@sheavly/protocol/model/model.types';
import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { Backend } from './client.types.js';
import { RemoteConversation } from './conversation.service.js';

/**
 * The one way a terminal entry point gets its conversation: reopens the saved `resume` (its own
 * history, workspace and model), or starts a new one, empty or continuing `messages`, with the
 * options a new conversation takes. They are not read when resuming.
 */
export function openConversation(params: {
  backend: Backend;
  resume?: ConversationId | undefined;
  messages?: ClientHistoryMessage[];
  workspace?: string | undefined;
  model?: string | undefined;
  mode?: ModelMode | undefined;
  /** The profile to start on instead of the workspace's own; not read when resuming. */
  profile?: ProfileId | undefined;
}): Promise<RemoteConversation> {
  const { backend, resume, messages, workspace, model, mode, profile } = params;

  if (resume) return RemoteConversation.reopen({ backend, id: resume });

  return RemoteConversation.open({
    backend,
    ...(messages && { messages }),
    ...(workspace && { workspace }),
    ...(model && { model }),
    ...(mode && { mode }),
    ...(profile && { profile }),
  });
}
