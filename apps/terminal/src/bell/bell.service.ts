import { now } from '@sheavly/core/clock/clock.helper';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { RunningTool, Write } from '../render/render.types.js';
import { APPROVAL_SETTLE_MS, LONG_TOOL_MS } from './bell.constants.js';

/** Sends BEL directly to the terminal, never through rendered text or saved scrollback. */
export class TerminalBell {
  readonly #enabled: boolean;
  readonly #write: Write;
  readonly #approvals = new Map<string, ReturnType<typeof setTimeout> | undefined>();
  readonly #tools = new Map<CallId, ReturnType<typeof setTimeout> | undefined>();
  #active = false;
  #stopped = false;

  constructor(params: { enabled: boolean; write: Write }) {
    this.#enabled = params.enabled;
    this.#write = params.write;
  }

  startTurn(): void {
    if (this.#stopped) return;
    this.finishTurn();
    this.#active = true;
  }

  /** Stops pending alerts on completion, failure or user cancellation. A new turn can start later. */
  finishTurn(): void {
    this.#active = false;

    for (const timer of this.#tools.values()) clearTimeout(timer);
    this.#tools.clear();
  }

  /** Called only after the backend confirmed completion, before finishTurn. */
  replyCompleted(): void {
    if (!this.#active) return;
    this.#ring();
    this.finishTurn();
  }

  /**
   * Rings once for a request that is still waiting after `APPROVAL_SETTLE_MS`. A replayed
   * conversation re-sends requests that were answered long ago, each followed at once by its
   * answer (`forgetApproval`), and those must stay silent.
   */
  requestApproval(id: string): void {
    if (this.#stopped || !this.#enabled || this.#approvals.has(id)) return;

    const timer = setTimeout(() => {
      // Keep the id after firing, so a repeated update of the same request cannot ring twice.
      this.#approvals.set(id, undefined);
      this.#ring();
    }, APPROVAL_SETTLE_MS);

    timer.unref();
    this.#approvals.set(id, timer);
  }

  forgetApproval(id: string): void {
    clearTimeout(this.#approvals.get(id));
    this.#approvals.delete(id);
  }

  /** Keeps one timer per live call; repeated snapshots neither postpone nor repeat its alert. */
  watchTools(tools: readonly RunningTool[]): void {
    if (!this.#enabled || this.#stopped || !this.#active) return;

    const live = new Set(tools.map(({ id }) => id));

    for (const [id, timer] of this.#tools) {
      if (live.has(id)) continue;
      clearTimeout(timer);
      this.#tools.delete(id);
    }

    for (const tool of tools) {
      if (!this.#tools.has(tool.id)) this.#watchTool(tool);
    }
  }

  /** Permanently silences this chat and releases its timers, including after a renderer failure. */
  stop(): void {
    this.#stopped = true;
    this.finishTurn();

    for (const timer of this.#approvals.values()) clearTimeout(timer);
    this.#approvals.clear();
  }

  #watchTool(tool: RunningTool): void {
    const delay = Math.max(0, LONG_TOOL_MS - Math.max(0, now() - tool.startedAt));
    const timer = setTimeout(() => {
      // Keep the id after firing, so a later snapshot of the same call cannot ring twice.
      this.#tools.set(tool.id, undefined);
      if (this.#active) this.#ring();
    }, delay);

    timer.unref();
    this.#tools.set(tool.id, timer);
  }

  #ring(): void {
    if (this.#enabled && !this.#stopped) this.#write('\u0007');
  }
}
