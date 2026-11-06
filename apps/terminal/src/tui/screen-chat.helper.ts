import { ProcessTerminal, TuiMainScreen } from '@earendil-works/pi-tui';
import { RefusedError } from '@sheavly/client/errors/client.errors';
import type { ApprovalUpdate } from '@sheavly/protocol/approval/approval.types';
import type { ConversationDetails } from '@sheavly/protocol/server/server.types';
import { ChatSession } from '../chat/chat-session.service.js';
import type { RemoteConversation } from '../client/conversation.service.js';
import { chatLook } from '../render/chat-look.utils.js';
import { Renderer } from '../render/render.service.js';
import { ReactView } from '../react-screen/react-view.service.js';
import { createClassicView } from './classic-view.helper.js';
import { ChatScreen } from './chat-screen.service.js';
import type { ApprovalAnswer, ScreenChat } from './tui.types.js';

/**
 * Runs the chat on the terminal's main screen: the conversation's text and the approvals it asks
 * for, a line that can be typed while it works (it queues), and a status line. Starts listening
 * for approvals before it takes any line, so the first command that needs one waits for the user
 * instead of being refused.
 *
 * `firstPrompt` is sent as soon as the screen is up. The caller prints its own startup lines
 * before this, so they stay above the screen in the scrollback.
 */
export async function startScreenChat(params: {
  conversation: RemoteConversation;
  details: ConversationDetails;
  skills: { name: string; description?: string }[];
  firstPrompt: string | undefined;
}): Promise<ScreenChat> {
  const { conversation, details, firstPrompt } = params;
  const watching = new AbortController();
  const status = {
    state: 'ready' as const,
    model: details.model.name,
    modelMode: details.model.mode ?? 'medium',
    mode: details.permissionMode,
    tasks: 0,
  };
  const editorOptions = {
    commands: [...ChatScreen.commands, ...params.skills],
    cwd: details.workspace,
  };
  const terminal = new ProcessTerminal();
  const view =
    process.env.SHEAVLY_TUI === 'classic'
      ? createClassicView({ ...editorOptions, tui: new TuiMainScreen(terminal) })
      : new ReactView({ ...editorOptions, terminal, status });
  const screen: ChatScreen = new ChatScreen({
    view,
    status,
    ...editorOptions,
    onSubmit: (line) => session.submit(line),
    onStop: () => session.stop(),
    onAnswer: (answer) => void answerApproval({ conversation, screen, answer }),
    onQuit: () => leave(),
  });
  const renderer = new Renderer(
    screen.write,
    () => conversation.runningTasks,
    chatLook,
    screen.reply,
  );
  let leave: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (leave = resolve));
  const session: ChatSession = new ChatSession({
    conversation,
    renderer,
    mainSession: details.session,
    write: screen.write,
    onSend: (text) => screen.echo(text),
    onQueue: (queue) => screen.setQueue(queue),
    onBusy: (busy) => {
      screen.setStatus({ state: busy ? 'working' : 'ready' });

      if (!busy) {
        void conversation
          .details()
          .then(({ model }) => {
            screen.setStatus({ model: model.name, modelMode: model.mode ?? 'medium' });
          })
          .catch((caughtError: unknown) =>
            screen.notice(`Could not refresh model: ${String(caughtError)}`),
          );
      }
    },
    onExit: () => leave(),
  });

  const { ended } = await conversation.watchApprovals({
    onUpdate: (update) => hear({ update, screen }),
    signal: watching.signal,
  });

  void ended.catch((caughtError: unknown) => {
    screen.notice(`✗ lost the approval stream: ${String(caughtError)}`);
  });

  screen.start();
  if (firstPrompt) session.submit(firstPrompt);

  return {
    finished: view instanceof ReactView ? Promise.race([finished, view.finished]) : finished,
    stop: async () => {
      watching.abort();
      session.dropQueued();
      session.stop();
      screen.stop();
    },
  };
}

/** What an approval update means for the screen: one asked appears, one gone disappears. */
function hear(params: { update: ApprovalUpdate; screen: ChatScreen }): void {
  const { update, screen } = params;

  if (update.type === 'approval_requested') screen.ask(update.request);
  else screen.forget(update.id);
}

/**
 * Sends the user's answer. One already answered elsewhere (`unknown_approval`) is not a failure:
 * the screen has been told it is gone. Anything else is shown, and the command that waited is
 * left to the backend, which refuses what nobody answers when the prompt ends.
 */
async function answerApproval(params: {
  conversation: RemoteConversation;
  screen: ChatScreen;
  answer: ApprovalAnswer;
}): Promise<void> {
  const { conversation, screen, answer } = params;

  try {
    await conversation.answerApproval({ approval: answer.id, response: answer.response });
  } catch (caughtError) {
    if (caughtError instanceof RefusedError && caughtError.code === 'unknown_approval') return;
    screen.notice(`✗ could not send your answer: ${String(caughtError)}`);
  }
}
