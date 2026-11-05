import type { Renderer } from '../render/render.service.js';
import type { Write } from '../render/render.types.js';
import { findSkillMentions } from '@sheavly/workspace/skills/skills.utils';
import { CHAT_HELP } from './chat.constants.js';
import type { ChatConversation, StopResult } from './chat.types.js';
import { listModels, parseChatInput, pickModel, unknownCommand } from './chat.utils.js';
import { modelModeSchema } from '@sheavly/protocol/model/model.validator';

/**
 * The chat's logic, apart from how a person types to it or sees it: lines go in (`submit`), the
 * conversation's output comes out through `write`. A line sent while another runs waits its turn
 * and is shown by `onQueue`, so what was typed is never lost or sent out of order. A UI decides
 * what a key does (Ctrl+C is `stop`) and what to show; this only does it.
 *
 * The chat's commands (`/help`, `/model`, `/exit`) and skills (`/<name>`) are read here, so every
 * UI that has a text box treats them the same.
 */
export class ChatSession {
  readonly #conversation: ChatConversation;
  readonly #renderer: Renderer;
  readonly #mainSession: string;
  readonly #write: Write;
  readonly #onQueue: (queue: readonly string[]) => void;
  readonly #onBusy: (busy: boolean) => void;
  readonly #onExit: () => void;
  #queue: string[] = [];
  #current: AbortController | undefined;
  #draining = false;
  #ended = false;
  #idle: Promise<void> = Promise.resolve();

  constructor(params: {
    conversation: ChatConversation;
    renderer: Renderer;
    /** The id of the conversation's main session: only its events are shown. */
    mainSession: string;
    write: Write;
    /** Told whenever the lines waiting their turn change. */
    onQueue?: (queue: readonly string[]) => void;
    /** Told when the chat starts running lines, and when it has run them all. */
    onBusy?: (busy: boolean) => void;
    /** Told once, when the user asked to leave. */
    onExit: () => void;
  }) {
    this.#conversation = params.conversation;
    this.#renderer = params.renderer;
    this.#mainSession = params.mainSession;
    this.#write = params.write;
    this.#onQueue = params.onQueue ?? (() => undefined);
    this.#onBusy = params.onBusy ?? (() => undefined);
    this.#onExit = params.onExit;
  }

  /** Whether a line is being run now. */
  get busy(): boolean {
    return this.#draining;
  }

  /** The lines waiting for the running one to finish, oldest first. */
  get queued(): readonly string[] {
    return this.#queue;
  }

  /**
   * Takes a line the user entered: run now when nothing runs, else after what is running. After
   * the user has asked to leave, lines are dropped, as they were never going to be sent.
   */
  submit(line: string): void {
    if (this.#ended) return;
    this.#queue.push(line);
    this.#onQueue(this.#queue);
    if (!this.#draining) this.#idle = this.#drain();
  }

  /** Resolves when nothing runs and nothing waits. */
  idle(): Promise<void> {
    return this.#idle;
  }

  /**
   * Stops the running prompt; its history stays valid and the next line continues from it. Lines
   * waiting still run after it: stopping a prompt is not leaving.
   */
  stop(): StopResult {
    if (!this.#current) return 'idle';
    if (this.#current.signal.aborted) return 'stopping';
    this.#current.abort();

    return 'stopped';
  }

  /** Drops the lines waiting, which a user who is leaving does not want sent. */
  dropQueued(): void {
    this.#queue = [];
    this.#onQueue(this.#queue);
  }

  async #drain(): Promise<void> {
    this.#draining = true;
    this.#onBusy(true);

    try {
      for (let line = this.#queue.shift(); line !== undefined; line = this.#queue.shift()) {
        this.#onQueue(this.#queue);
        if (!(await this.#handle(line))) break;
      }
    } finally {
      this.#draining = false;
      this.#onBusy(false);
    }
  }

  /** Handles one line; false once the user asked to leave. */
  async #handle(line: string): Promise<boolean> {
    const parsed = parseChatInput(line);

    switch (parsed.kind) {
      case 'exit':
        this.#ended = true;
        this.dropQueued();
        this.#onExit();

        return false;
      case 'help':
        this.#print(CHAT_HELP);
        break;
      case 'model':
        await this.#printCommand(() => this.#modelCommand(parsed.name));
        break;
      case 'mode':
        await this.#printCommand(() => this.#modeCommand(parsed.name));
        break;
      case 'prompt':
        await this.#send(parsed.text);
        break;
      case 'empty':
        break;
    }

    return true;
  }

  #print(text: string): void {
    this.#write(`${text}\n`);
  }

  async #printCommand(run: () => Promise<string>): Promise<void> {
    try {
      this.#print(await run());
    } catch (caughtError) {
      this.#print(`✗ ${caughtError instanceof Error ? caughtError.message : String(caughtError)}`);
    }
  }

  /**
   * Runs one message to its end, printing its entries; a failure is shown, and the chat goes on.
   * Skills it mentions (`/<name>` anywhere in it) run with it; one it starts with that no skill
   * has is an unknown command, reported instead of sent.
   */
  async #send(text: string): Promise<void> {
    const current = new AbortController();

    this.#current = current;

    try {
      const known = new Set((await this.#conversation.skills()).map(({ name }) => name));
      const unknown = unknownCommand({
        text,
        unknown: findSkillMentions(text)
          .map(({ name }) => name)
          .filter((name) => !known.has(name)),
      });

      if (unknown) {
        this.#print(`Unknown command /${unknown}; /help lists them.`);

        return;
      }

      for await (const entry of this.#conversation.send({ text, signal: current.signal })) {
        this.#renderer.entry(entry, this.#mainSession);
      }
    } catch (caughtError) {
      this.#write(
        `\n✗ ${caughtError instanceof Error ? caughtError.message : String(caughtError)}\n`,
      );
    } finally {
      this.#current = undefined;
    }

    this.#write('\n');
  }

  /**
   * `/model` lists the models; `/model <id or name>` switches to one, from the next model call on.
   * What is typed only finds the model (`pickModel`): the switch is made by its id.
   */
  async #modelCommand(typed: string | undefined): Promise<string> {
    const { model, models } = await this.#conversation.details();

    if (models.length === 0) {
      return `Only ${model.adapter} / ${model.model} is set up in this profile: add another model to switch.`;
    }

    if (typed === undefined) return listModels({ choices: models, active: model.id });

    const picked = pickModel({ choices: models, typed });

    if (picked.kind === 'none') return `Unknown model ${typed}; /model lists them.`;

    if (picked.kind === 'ambiguous') {
      const same = listModels({ choices: picked.choices, active: model.id });

      return `${String(picked.choices.length)} models are called ${typed}; use an id:\n${same}`;
    }

    const { choice } = picked;

    if (!(await this.#conversation.useModel(choice.id))) {
      return `Unknown model ${typed}; /model lists them.`;
    }

    const updated = await this.#conversation.details();

    return `→ ${choice.name}: ${choice.adapter} / ${choice.model} · ${updated.model.mode ?? 'medium'}`;
  }

  async #modeCommand(typed: string | undefined): Promise<string> {
    const { model } = await this.#conversation.details();

    if (typed === undefined) {
      return `${model.name} · ${model.mode ?? 'medium'}\nModes: low, medium, high, extreme`;
    }

    const mode = modelModeSchema.safeParse(typed.toLowerCase());

    if (!mode.success) return 'Choose a mode: low, medium, high, extreme.';

    if (!(await this.#conversation.useModel(model.id, mode.data))) {
      return 'The selected model is no longer available.';
    }

    return `→ ${model.name} · ${mode.data}`;
  }
}
