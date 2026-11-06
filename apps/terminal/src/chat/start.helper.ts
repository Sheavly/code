import path from 'node:path';
import { createClient } from '@sheavly/client/client/client.helper';
import { openSession } from '../client/session.helper.js';
import { prepareSetup } from '../setup/setup.helper.js';
import { startScreenChat } from '../tui/screen-chat.helper.js';
import { runLineChat } from './line-chat.helper.js';

/** Owns startup and shutdown, including setup before a conversation exists. */
export async function runTerminalChat(): Promise<void> {
  const write = (text: string) => void process.stdout.write(text);
  const args = process.argv.slice(2);
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const workspace = path.resolve(process.env.WORKSPACE_ROOT ?? process.cwd());
  const session = await openSession({
    env: process.env,
    args: args.filter((arg) => arg !== '--setup'),
    write,
    workspace,
    prepare: (backend) =>
      prepareSetup({
        backend,
        workspace,
        interactive,
        force: args.includes('--setup'),
      }),
  });
  const { backend, conversation, details, renderer, prompt: firstPrompt } = session;
  let closing: Promise<void> | undefined;
  const end = () => (closing ??= conversation.close().finally(() => backend.stop()));
  const onHangup = () => void end().finally(() => process.exit(129));
  const onTerminate = () => void end().finally(() => process.exit(143));

  process.once('SIGHUP', onHangup);
  process.once('SIGTERM', onTerminate);

  try {
    if (interactive && !process.env.SHEAVLY_PLAIN) {
      const skills = (await conversation.skills()).map(({ name, description }) => ({
        name,
        description,
      }));
      const terminal = await createClient(backend).call('migrateTerminalSettings', {});
      const chat = await startScreenChat({
        conversation,
        details,
        skills,
        firstPrompt,
        reducedMotion: terminal.reducedMotion ?? false,
        bell: terminal.bell ?? false,
      });

      try {
        await chat.finished;
      } finally {
        await chat.stop();
      }
    } else {
      await runLineChat({
        conversation,
        details,
        renderer,
        write,
        firstPrompt,
        forceQuit: () => void end().finally(() => process.exit(130)),
      });
    }
  } finally {
    process.off('SIGHUP', onHangup);
    process.off('SIGTERM', onTerminate);
    await end();
  }

  write('→ conversation ended\n');
}
