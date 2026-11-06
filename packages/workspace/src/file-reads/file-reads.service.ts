import { MAX_CHUNKS_PER_FILE } from './file-reads.constants.js';

/** What one agent has been shown of one file. */
type Seen = {
  /** Pieces of the file as shown, kept in step with the agent's own edits. */
  chunks: string[];
  /** Some read showed the whole file. */
  whole: boolean;
};

/**
 * What each agent has been shown of each file, so a tool that changes a file can refuse text the
 * agent never saw: an edit made from memory, or from a guess, is the likeliest to be wrong. It
 * keeps the text itself, not line numbers, which go stale when anything above them changes.
 *
 * An agent is a session (the main agent, or one sub-agent): what the parent saw does not count for
 * a child, nor the other way round, since each works from what it was shown. One instance is shared
 * by the file tools of a harness (`createCodingHarness` makes it); a test makes its own. Files are
 * named by their real path, as `FileLocks` does.
 *
 * Nothing here stops a file changing after it was read: an edit still has to match the text that
 * is there now.
 */
export class FileReads {
  readonly #seen = new Map<string, Seen>();

  /**
   * Remembers that `agent` was shown `text` of `file`: what a read returned, or all of a file the
   * agent made. `whole` when that is the entire file, which replaces anything seen before it.
   */
  markRead(params: { agent: string; file: string; text: string; whole: boolean }): void {
    const { agent, file, text, whole } = params;
    const key = keyOf({ agent, file });

    if (whole) {
      this.#seen.set(key, { chunks: [text], whole: true });

      return;
    }

    const seen = this.#seen.get(key) ?? { chunks: [], whole: false };

    seen.chunks.push(text);
    // Dropping the oldest never drops a whole-file read: that one is `chunks[0]` and stays.
    if (seen.chunks.length > MAX_CHUNKS_PER_FILE) seen.chunks.splice(seen.whole ? 1 : 0, 1);
    this.#seen.set(key, seen);
  }

  /** Whether `agent` was shown anything of `file`. */
  hasRead(params: { agent: string; file: string }): boolean {
    return this.#seen.has(keyOf(params));
  }

  /** Whether some read showed `agent` the whole of `file`. */
  hasReadWhole(params: { agent: string; file: string }): boolean {
    return this.#seen.get(keyOf(params))?.whole ?? false;
  }

  /** Whether `text` is inside one piece of `file` that `agent` was shown. */
  hasSeen(params: { agent: string; file: string; text: string }): boolean {
    const { text } = params;

    return this.#seen.get(keyOf(params))?.chunks.some((chunk) => chunk.includes(text)) ?? false;
  }

  /**
   * Keeps what `agent` saw in step with an edit it made: the replaced text is now `newText` in
   * every piece that held it, so the agent can edit that place again without reading it back.
   */
  markEdited(params: {
    agent: string;
    file: string;
    oldText: string;
    newText: string;
    replaceAll: boolean;
  }): void {
    const { oldText, newText, replaceAll } = params;
    const seen = this.#seen.get(keyOf(params));

    if (!seen) return;

    seen.chunks = seen.chunks.map((chunk) =>
      replaceAll ? chunk.replaceAll(oldText, () => newText) : chunk.replace(oldText, () => newText),
    );
  }
}

function keyOf(params: { agent: string; file: string }): string {
  return JSON.stringify([params.agent, params.file]);
}
