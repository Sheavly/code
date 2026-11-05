import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  matchesKey,
  Text,
  type EditorTheme,
  type SelectListTheme,
  type TUI,
} from '@earendil-works/pi-tui';
import { styleText } from 'node:util';
import { now } from '@sheavly/core/clock/clock.helper';
import type { ApprovalRequest } from '@sheavly/protocol/approval/approval.types';
import { CHAT_COMMANDS } from '../chat/chat.constants.js';
import { ApprovalPrompt } from './approval-prompt.service.js';
import { QUIT_WINDOW_MS } from './tui.constants.js';
import { LineBuffer } from './line-buffer.service.js';
import type { ApprovalAnswer, ApprovalOutcome, StatusInfo } from './tui.types.js';
import { approvalText, queueText, statusText } from './view.utils.js';

const gray = (text: string) => styleText('gray', text, { validateStream: false });

const selectTheme: SelectListTheme = {
  selectedPrefix: (text) => styleText('cyan', text, { validateStream: false }),
  selectedText: (text) => styleText(['cyan', 'bold'], text, { validateStream: false }),
  description: gray,
  scrollInfo: gray,
  noMatch: gray,
};
const editorTheme: EditorTheme = { borderColor: gray, selectList: selectTheme };

/** Keys the screen reads before the editor does. `undefined` leaves the key to the editor. */
type KeyResult = { consume: true } | undefined;

/**
 * The chat on a terminal's main screen: finished lines go into the terminal's own scrollback, so
 * its search, selection and history keep working, and only a small area at the bottom is redrawn
 * (the line being written, a waiting approval, queued messages, the status line and the editor).
 *
 * It draws and reads keys; what a line, a stop or an answer does is the caller's (`ChatScreen`'s
 * callbacks). Text comes in through `write`, as the `Renderer` writes it.
 *
 * Keys, by what the user is doing: with an approval waiting and the editor empty, ↑↓ or 1-4
 * choose, Enter confirms the chosen one and Esc skips. Nothing is chosen at first, so Enter never
 * answers by accident; and once any text is typed, every key is the editor's, so a half-typed
 * line is never swallowed by a question.
 */
export class ChatScreen {
  readonly #tui: TUI;
  readonly #history = new Container();
  readonly #live = new Text('', 0, 0);
  readonly #approval = new Text('', 0, 0);
  readonly #queue = new Text('', 0, 0);
  readonly #status = new Text('', 0, 0);
  readonly #editor: Editor;
  readonly #lines = new LineBuffer();
  readonly #prompt = new ApprovalPrompt();
  readonly #callbacks: {
    onSubmit: (line: string) => void;
    onStop: () => 'stopped' | 'stopping' | 'idle';
    onAnswer: (answer: ApprovalAnswer) => void;
    onQuit: () => void;
  };
  #info: StatusInfo;
  #quitArmedAt = 0;

  constructor(params: {
    tui: TUI;
    status: StatusInfo;
    /** Skill names offered after a `/`, read when the user types. */
    commands: { name: string; description?: string }[];
    cwd: string;
    onSubmit: (line: string) => void;
    /** Ctrl+C or Esc while a prompt runs. */
    onStop: () => 'stopped' | 'stopping' | 'idle';
    onAnswer: (answer: ApprovalAnswer) => void;
    onQuit: () => void;
  }) {
    const { tui, status, commands, cwd, ...callbacks } = params;

    this.#tui = tui;
    this.#info = status;
    this.#callbacks = callbacks;
    this.#editor = new Editor(tui, editorTheme);
    this.#editor.setAutocompleteProvider(new CombinedAutocompleteProvider(commands, cwd));
    this.#editor.onSubmit = (text) => this.#submit(text);

    for (const child of [
      this.#history,
      this.#live,
      this.#approval,
      this.#queue,
      this.#status,
      this.#editor,
    ]) {
      tui.addChild(child);
    }

    tui.setFocus(this.#editor);
    tui.addInputListener((data) => this.#key(data));
    this.#refresh();
  }

  /** The chat's own commands, for the editor to complete; the skills come with the caller's. */
  static readonly commands = CHAT_COMMANDS.map((name) => ({ name: name.slice(1) }));

  /** Starts drawing and reading keys. */
  start(): void {
    this.#tui.start();
  }

  /** Stops, leaving the terminal as it was; the conversation stays in its scrollback. */
  stop(): void {
    this.#flushTail();
    this.#tui.stop();
  }

  /** Where text for the conversation goes: the `Renderer`'s and the session's `write`. */
  readonly write = (text: string): void => {
    for (const line of this.#lines.push(text)) this.#print(line);
    this.#live.setText(this.#lines.tail);
    this.#tui.requestRender();
  };

  /** Shows a line the screen itself says (a notice), apart from the conversation's text. */
  notice(text: string): void {
    this.#flushTail();
    this.#print(gray(text));
    this.#tui.requestRender();
  }

  /** Changes what the status line says. */
  setStatus(patch: Partial<StatusInfo>): void {
    this.#info = { ...this.#info, ...patch };
    this.#refresh();
  }

  /** Shows the lines waiting for the running one to finish. */
  setQueue(queue: readonly string[]): void {
    this.#queue.setText(queueText(queue));
    this.#tui.requestRender();
  }

  /** An approval was asked: it waits for the user's answer, behind any already waiting. */
  ask(request: ApprovalRequest): void {
    this.#prompt.ask(request);
    this.#refresh();
  }

  /** An approval was answered elsewhere or given up on. */
  forget(id: ApprovalRequest['id']): void {
    this.#prompt.forget(id);
    this.#refresh();
  }

  /** Whether an approval waits for the user. */
  get asking(): boolean {
    return this.#prompt.current !== undefined;
  }

  #print(line: string): void {
    this.#history.addChild(new Text(line, 0, 0));
  }

  #flushTail(): void {
    const tail = this.#lines.flush();

    if (tail !== undefined) this.#print(tail);
    this.#live.setText('');
  }

  #refresh(): void {
    this.#approval.setText(approvalText(this.#prompt));
    this.#status.setText(
      statusText({ ...this.#info, state: this.asking ? 'waiting' : this.#info.state }),
    );
    this.#tui.requestRender();
  }

  /** What Enter in the editor does: send the line, or, while a message is asked for, answer with it. */
  #submit(text: string): void {
    const line = text.trim();

    if (this.#prompt.phase === 'message') {
      this.#finish(this.#prompt.skip(line));
      this.#editor.setText('');

      return;
    }

    if (!line) return;
    this.#editor.addToHistory(line);
    this.#editor.setText('');
    this.#callbacks.onSubmit(line);
  }

  #finish(outcome: ApprovalOutcome): void {
    if (outcome.kind === 'answer') this.#callbacks.onAnswer(outcome.answer);
    this.#refresh();
  }

  /** The keys the screen takes before the editor sees them. */
  #key(data: string): KeyResult {
    if (matchesKey(data, 'ctrl+c')) return this.#interrupt();

    // Ctrl+D on an empty line leaves, as in a shell; with text in the editor it deletes, as there.
    if (matchesKey(data, 'ctrl+d') && this.#editor.getText() === '' && !this.asking) {
      this.#callbacks.onQuit();

      return { consume: true };
    }

    if (!this.asking) return undefined;

    if (this.#prompt.phase === 'message') {
      if (!matchesKey(data, 'escape')) return undefined;
      this.#prompt.cancelMessage();
      this.#editor.setText('');
      this.#refresh();

      return { consume: true };
    }

    // Typing has begun: the question waits, and every key is the editor's.
    if (this.#editor.getText() !== '') return undefined;

    return this.#choose(data);
  }

  #choose(data: string): KeyResult {
    if (matchesKey(data, 'down')) this.#prompt.move(1);
    else if (matchesKey(data, 'up')) this.#prompt.move(-1);
    else if (/^[1-9]$/.test(data)) this.#prompt.pickNumber(Number(data));
    else if (matchesKey(data, 'enter')) this.#confirm();
    else if (matchesKey(data, 'escape')) this.#finish(this.#prompt.skip());
    else return undefined;

    this.#refresh();

    return { consume: true };
  }

  #confirm(): void {
    const outcome = this.#prompt.confirm();

    if (outcome.kind === 'needs_message') this.#editor.setText('');
    this.#finish(outcome);
  }

  /**
   * Ctrl+C: stops a running prompt (and skips what it waits on); with nothing running, a second
   * press within a moment quits, so one stray press never ends the conversation.
   */
  #interrupt(): KeyResult {
    this.#skipWaiting();

    if (this.#callbacks.onStop() !== 'idle') return { consume: true };
    if (now() - this.#quitArmedAt < QUIT_WINDOW_MS) this.#callbacks.onQuit();

    this.#quitArmedAt = now();
    this.notice('Press Ctrl+C again to quit');

    return { consume: true };
  }

  /** A stopped prompt no longer waits on its approvals: they are skipped, so it can end. */
  #skipWaiting(): void {
    for (const request of this.#prompt.drain()) {
      this.#callbacks.onAnswer({ id: request.id, response: { decision: 'skip' } });
    }

    this.#editor.setText('');
    this.#refresh();
  }
}
