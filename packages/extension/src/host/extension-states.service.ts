import { ExtensionStateError } from '../errors/extension.errors.js';
import type { ExtensionLife, ExtensionState } from './extension-state.types.js';
import { canMove } from './extension-state.utils.js';

/**
 * The one state of each extension in a host, moved only along `EXTENSION_TRANSITIONS`. What an
 * extension has contributed so far is read from here, never from a separate record: its tool
 * names count only while it is `merged`.
 */
export class ExtensionStates {
  readonly #lives = new Map<string, ExtensionLife>();

  constructor(extensions: Iterable<string>) {
    for (const extension of extensions) this.#lives.set(extension, { state: 'sealed' });
  }

  /** The state of an extension the host was built with. */
  stateOf(extension: string): ExtensionState {
    return this.#life(extension).state;
  }

  /** Moves to `verified`, recording the tool names the manifest check passed. Throws when the table refuses it. */
  verify(params: { extension: string; tools: readonly string[] }): void {
    const { extension, tools } = params;

    this.#assertMove({ extension, to: 'verified' });
    this.#lives.set(extension, { state: 'verified', tools });
  }

  /** Moves to `to`; `merged` keeps the names recorded at `verified`. Throws when the table refuses it. */
  move(params: { extension: string; to: Exclude<ExtensionState, 'verified'> }): void {
    const { extension, to } = params;
    const from = this.#life(extension);

    this.#assertMove({ extension, to });

    if (to === 'merged') {
      this.#lives.set(extension, { state: 'merged', tools: 'tools' in from ? from.tools : [] });

      return;
    }

    this.#lives.set(extension, { state: to });
  }

  /** The tool names the extension contributed, once the merge passed; empty in every other state. */
  contributedTools(extension: string): readonly string[] {
    const life = this.#lives.get(extension);

    return life?.state === 'merged' ? life.tools : [];
  }

  #life(extension: string): ExtensionLife {
    const life = this.#lives.get(extension);

    if (!life) throw new ExtensionStateError({ extension, from: 'unknown', to: 'unknown' });

    return life;
  }

  #assertMove(params: { extension: string; to: ExtensionState }): void {
    const { extension, to } = params;
    const from = this.stateOf(extension);

    if (!canMove({ from, to })) throw new ExtensionStateError({ extension, from, to });
  }
}
