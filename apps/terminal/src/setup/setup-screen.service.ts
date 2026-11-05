import { Container, matchesKey, SelectList, Text } from '@earendil-works/pi-tui';
import type { SelectItem, TUI } from '@earendil-works/pi-tui';
import { SetupCancelledError } from '../errors/setup.errors.js';
import { SetupInput } from './setup-input.service.js';
import type { SetupText, SetupUi } from './setup.types.js';

/** A single setup screen whose fields are replaced, so API keys never reach scrollback. */
export class SetupScreen implements SetupUi {
  readonly #abort = new AbortController();
  readonly #title = new Text('Welcome to Sheavly', 1, 1);
  readonly #notice = new Text('', 1, 0);
  readonly #question = new Text('', 1, 1);
  readonly #body = new Container();
  readonly #help = new Text('↑↓ to choose · Enter to continue · Esc or Ctrl+C to cancel', 1, 1);
  #reject: ((reason: unknown) => void) | undefined;

  constructor(readonly tui: TUI) {
    for (const child of [this.#title, this.#notice, this.#question, this.#body, this.#help]) {
      tui.addChild(child);
    }

    tui.addInputListener((data) => {
      if (!matchesKey(data, 'ctrl+c') && !matchesKey(data, 'escape')) return undefined;
      this.#cancel();

      return { consume: true };
    });
  }

  get signal(): AbortSignal {
    return this.#abort.signal;
  }

  start(): void {
    this.tui.start();
  }

  stop(): void {
    this.#body.clear();
    this.tui.setFocus(null);
    this.tui.stop();
  }

  notice(message: string): void {
    this.#notice.setText(message);
    this.tui.requestRender();
  }

  text(question: SetupText): Promise<string> {
    this.signal.throwIfAborted();
    this.#question.setText([question.title, question.description ?? ''].join('\n'));
    const input = new SetupInput(question.secret ?? false);

    if (!question.secret) input.setValue(question.initial ?? '');
    this.#body.clear();
    this.#body.addChild(input);
    this.tui.setFocus(input);
    this.tui.requestRender();

    return new Promise((resolve, reject) => {
      this.#reject = reject;

      input.onSubmit = (value) => {
        const text = value.trim();
        const problem = question.validate?.(text);

        if (problem) {
          this.notice(problem);

          return;
        }

        input.setValue('');
        this.#body.clear();
        this.tui.setFocus(null);
        this.#reject = undefined;
        resolve(text);
      };
    });
  }

  choose(question: { title: string; items: SelectItem[]; initial?: string }): Promise<string> {
    this.signal.throwIfAborted();
    this.#question.setText(question.title);
    const identity = (text: string) => text;
    const list = new SelectList(question.items, 8, {
      selectedPrefix: identity,
      selectedText: identity,
      description: identity,
      scrollInfo: identity,
      noMatch: identity,
    });

    const selected = question.items.findIndex(({ value }) => value === question.initial);

    if (selected >= 0) list.setSelectedIndex(selected);
    this.#body.clear();
    this.#body.addChild(list);
    this.tui.setFocus(list);
    this.tui.requestRender();

    return new Promise((resolve, reject) => {
      this.#reject = reject;

      list.onSelect = ({ value }) => {
        this.#reject = undefined;
        this.tui.setFocus(null);
        resolve(value);
      };
    });
  }

  #cancel(): void {
    const error = new SetupCancelledError();

    this.#abort.abort(error);
    this.#reject?.(error);
    this.#reject = undefined;
  }
}
