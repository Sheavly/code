import { stripVTControlCharacters } from 'node:util';
import { FIRST_LINE_MAX } from '../render/render.constants.js';
import { firstLine } from '../render/render.utils.js';
import type { Failure } from './failures.types.js';

/**
 * The failed steps of a chat that have more to say than the line shown under them, numbered from
 * 1, so the screen can show them collapsed as they happen and in full when asked. It keeps what
 * the terminal has seen, as `ChangeLog` does.
 */
export class FailureLog {
  readonly #failures: Failure[] = [];

  /** The failures kept so far, oldest first. */
  get failures(): readonly Failure[] {
    return this.#failures;
  }

  /**
   * Keeps a failed step's message as the next numbered failure, and returns it. A message that
   * is one line and fits the line shown has nothing more to say: `undefined`, nothing kept.
   */
  keep(params: { title: string; content: string }): Failure | undefined {
    const content = stripVTControlCharacters(params.content).trimEnd();
    const lines = content.split('\n').filter((line) => line.trim() !== '');
    const [first = ''] = lines;
    const moreLines = lines.length - 1;

    if (moreLines <= 0 && first.length <= FIRST_LINE_MAX) return undefined;

    const failure = {
      number: this.#failures.length + 1,
      title: params.title,
      summary: firstLine(content),
      content,
      moreLines: Math.max(moreLines, 0),
    };

    this.#failures.push(failure);

    return failure;
  }
}
