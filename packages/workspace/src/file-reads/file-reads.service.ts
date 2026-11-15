import { MAX_CHUNKS_PER_FILE, MAX_PERSISTED_FILES } from './file-reads.constants.js';
import type { FileView, FileViews } from './file-reads.types.js';

type Seen = FileView;

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
 * Each view carries a hash of the whole file as it was then. A tool that has the file's current
 * text under its lock asks `forgetIfChanged` with that text's hash: a file that changed since
 * (by a command, the user or another agent) is forgotten, so the next edit needs a new read, and
 * a file that did not change keeps its reads, so nothing is read twice for nothing.
 */
export class FileReads {
  /** What each agent was shown, by the file's real path, then by agent. */
  readonly #seen = new Map<string, Map<string, Seen>>();

  /**
   * Remembers that `agent` was shown `text` of `file`: what a read returned, or all of a file the
   * agent made. `hash` is `hashText` of the whole file at that moment. `whole` when `text` is the
   * entire file, which replaces anything seen before it; a piece of a file that has changed since
   * the pieces already kept replaces them, since they describe another version.
   */
  markRead(params: {
    agent: string;
    file: string;
    text: string;
    whole: boolean;
    hash: string;
  }): void {
    const { agent, file, text, whole, hash } = params;
    const byAgent = this.agentsFor(file);

    if (whole) {
      byAgent.set(agent, { chunks: [text], whole: true, hash });

      return;
    }

    const earlier = byAgent.get(agent);
    const seen = earlier?.hash === hash ? earlier : { chunks: [], whole: false, hash };

    seen.chunks.push(text);
    // Dropping the oldest never drops a whole-file read: that one is `chunks[0]` and stays.
    if (seen.chunks.length > MAX_CHUNKS_PER_FILE) seen.chunks.splice(seen.whole ? 1 : 0, 1);
    byAgent.set(agent, seen);
  }

  /**
   * Forgets what `agent` was shown of `file` when the file is no longer what it saw: `hash` is
   * `hashText` of the file's current text, read under its lock. Returns whether something was
   * forgotten, so a tool can say the file changed instead of saying it was never read.
   */
  forgetIfChanged(params: { agent: string; file: string; hash: string }): boolean {
    const { agent, file, hash } = params;
    const byAgent = this.#seen.get(file);

    if (!byAgent || byAgent.get(agent)?.hash === hash || !byAgent.has(agent)) return false;

    byAgent.delete(agent);
    if (byAgent.size === 0) this.#seen.delete(file);

    return true;
  }

  /** Whether `agent` was shown anything of `file`. */
  hasRead(params: { agent: string; file: string }): boolean {
    return this.#seen.get(params.file)?.has(params.agent) ?? false;
  }

  /** Whether some read showed `agent` the whole of `file`. */
  hasReadWhole(params: { agent: string; file: string }): boolean {
    return this.#seen.get(params.file)?.get(params.agent)?.whole ?? false;
  }

  /** Whether `text` is inside one piece of `file` that `agent` was shown. */
  hasSeen(params: { agent: string; file: string; text: string }): boolean {
    const { text } = params;
    const seen = this.#seen.get(params.file)?.get(params.agent);

    return seen?.chunks.some((chunk) => chunk.includes(text)) ?? false;
  }

  /**
   * Keeps what `agent` saw in step with an edit it made: the replaced text is now `newText` in
   * every piece that held it, so the agent can edit that place again without reading it back.
   * `hash` is `hashText` of the file as the edit left it. Other agents' views of the file are
   * left as they were: their hash no longer matches, so their next edit asks for a new read.
   */
  markEdited(params: {
    agent: string;
    file: string;
    oldText: string;
    newText: string;
    replaceAll: boolean;
    hash: string;
  }): void {
    const { oldText, newText, replaceAll, hash } = params;
    const seen = this.#seen.get(params.file)?.get(params.agent);

    if (!seen) return;

    seen.hash = hash;
    seen.chunks = seen.chunks.map((chunk) =>
      replaceAll ? chunk.replaceAll(oldText, () => newText) : chunk.replace(oldText, () => newText),
    );
  }

  /**
   * Forgets what every agent was shown of `file`, which is gone. A file created at that path
   * afterwards holds other text, and what the old one said is exactly the memory an edit must not
   * be made from.
   */
  markDeleted(params: { file: string }): void {
    this.#seen.delete(params.file);
  }

  /**
   * What `agent` was shown, to keep with its conversation: the last `MAX_PERSISTED_FILES` files it
   * read, copied so later reads do not change it. `importAgent` is its counterpart.
   */
  exportAgent(params: { agent: string }): FileViews {
    const views: FileViews = {};
    const own = [...this.#seen].flatMap(([file, byAgent]) => {
      const seen = byAgent.get(params.agent);

      return seen ? [[file, seen] as const] : [];
    });

    for (const [file, seen] of own.slice(-MAX_PERSISTED_FILES)) {
      views[file] = { chunks: [...seen.chunks], whole: seen.whole, hash: seen.hash };
    }

    return views;
  }

  /**
   * Gives `agent` the views a reopened conversation kept. They are not trusted to still hold: each
   * carries the hash of the file when it was read, so the next edit or delete compares it with the
   * file now and asks for a new read if the file changed in the meantime.
   */
  importAgent(params: { agent: string; views: FileViews }): void {
    for (const [file, view] of Object.entries(params.views)) {
      this.agentsFor(file).set(params.agent, {
        chunks: [...view.chunks],
        whole: view.whole,
        hash: view.hash,
      });
    }
  }

  /** Forgets what one agent was shown, when its session ends. */
  forgetAgent(params: { agent: string }): void {
    for (const [file, byAgent] of this.#seen) {
      byAgent.delete(params.agent);
      if (byAgent.size === 0) this.#seen.delete(file);
    }
  }

  private agentsFor(file: string): Map<string, Seen> {
    const byAgent = this.#seen.get(file) ?? new Map<string, Seen>();

    this.#seen.set(file, byAgent);

    return byAgent;
  }
}
