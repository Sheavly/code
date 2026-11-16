import type { ConversationDetails } from '@sheavly/protocol/server/server.types';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { BackendError } from '../errors/backend.errors.js';
import { Renderer } from '../render/render.service.js';
import { projectTrustNotice } from '../render/render.utils.js';
import { connectBackend } from './backend.helper.js';
import type { Backend } from './client.types.js';
import { RemoteConversation } from './conversation.service.js';

/**
 * A terminal CLI's conversation, as the chat and the demo open it: the backend (started with
 * `env` and `--trust` from `args`, its output written as it comes), a new conversation on it, its
 * details and a renderer. `prompt` is the rest of `args`. Prints what the run is: the model, the
 * workspace, the permission mode and why `.sheavly/` hooks didn't load.
 */
export async function openSession(params: {
  env: NodeJS.ProcessEnv;
  args: readonly string[];
  write: (text: string) => void;
  workspace?: string;
  /** A chat may configure the backend before opening its first conversation. */
  prepare?: (backend: Backend) => Promise<ModelId | undefined>;
}): Promise<{
  backend: Backend;
  conversation: RemoteConversation;
  details: ConversationDetails;
  renderer: Renderer;
  prompt: string;
}> {
  const { env, args, write } = params;
  const resume = resumeArgs(args);
  const backend = await connectBackend({
    env,
    args: args.filter((arg) => arg === '--trust'),
    onOutput: write,
  });
  let conversation: RemoteConversation | undefined;

  try {
    const model = await params.prepare?.(backend);

    if (resume.id) conversation = await RemoteConversation.reopen({ backend, id: resume.id });
    else {
      conversation = await RemoteConversation.open({
        backend,
        ...(params.workspace && { workspace: params.workspace }),
      });
    }

    if (!resume.id && model && !(await conversation.useModel(model))) {
      throw new BackendError({
        message: 'The selected model is no longer available. Run with --setup again.',
      });
    }

    return await describeSession({ backend, conversation, args: resume.args, write });
  } catch (caughtError) {
    try {
      await conversation?.close();
    } finally {
      await backend.stop();
    }

    throw caughtError;
  }
}

function resumeArgs(args: readonly string[]) {
  const index = args.indexOf('--resume');

  if (index === -1) return { id: undefined, args };

  const parsed = conversationIdSchema.safeParse(args[index + 1]);

  if (!parsed.success) {
    throw new BackendError({ message: '--resume requires a conversation id (a lowercase UUID)' });
  }

  return {
    id: parsed.data,
    args: args.filter((_, position) => position !== index && position !== index + 1),
  };
}

async function describeSession(params: {
  backend: Backend;
  conversation: RemoteConversation;
  args: readonly string[];
  write: (text: string) => void;
}) {
  const { backend, conversation, args, write } = params;
  const details = await conversation.details();

  write(`→ conversation ${conversation.id} (reopen with --resume)\n`);
  write(`→ ${details.model.adapter} / ${details.model.model} in ${details.workspace}\n`);

  if (details.permissionMode === 'allow_all') {
    write('⚠ run_command is on allow all: any command can run without asking\n');
  }

  const trustNotice = projectTrustNotice(details.projectTrust);

  if (trustNotice) write(`${trustNotice}\n`);

  return {
    backend,
    conversation,
    details,
    renderer: new Renderer(write),
    prompt: args.filter((arg) => arg !== '--trust').join(' '),
  };
}
