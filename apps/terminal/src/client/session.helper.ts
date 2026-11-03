import type { ConversationDetails } from '@sheavly/protocol/server/server.types';
import { Renderer } from '../render/render.service.js';
import { projectTrustNotice } from '../render/render.utils.js';
import { connectBackend } from './backend.helper.js';
import type { Backend } from './client.types.js';
import { RemoteConversation } from './conversation.service.js';

/**
 * A terminal CLI's conversation, as the chat and the demo open it: the backend (started with
 * `env` and `--trust` from `args`, its output written as it comes), a new conversation on it, its
 * details and a renderer. `prompt` is the rest of `args`. Prints what the run is: the model, the
 * workspace, the allow list and why `.sheavly/` hooks didn't load.
 */
export async function openSession(params: {
  env: NodeJS.ProcessEnv;
  args: readonly string[];
  write: (text: string) => void;
}): Promise<{
  backend: Backend;
  conversation: RemoteConversation;
  details: ConversationDetails;
  renderer: Renderer;
  prompt: string;
}> {
  const { env, args, write } = params;
  const backend = await connectBackend({
    env,
    args: args.filter((arg) => arg === '--trust'),
    onOutput: write,
  });
  const conversation = await RemoteConversation.open({ backend });
  const details = await conversation.details();

  write(`→ ${details.model.adapter} / ${details.model.model} in ${details.workspace}\n`);

  if (details.skipAllowList) {
    write('⚠ run_command allow list is OFF: any shell command can run\n');
  }

  const trustNotice = projectTrustNotice(details.projectTrust);

  if (trustNotice) write(`${trustNotice}\n`);

  return {
    backend,
    conversation,
    details,
    renderer: new Renderer(write, () => conversation.runningTasks),
    prompt: args.filter((arg) => arg !== '--trust').join(' '),
  };
}
