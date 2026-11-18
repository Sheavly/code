import type { SessionId } from '@sheavly/protocol/session/session.types';
import {
  MAX_CHUNKS_PER_FILE,
  MAX_PERSISTED_CHARS,
  MAX_PERSISTED_FILES,
} from './file-reads.constants.js';
import type { FileView, FileViews } from './file-reads.types.js';
import { hashText } from './file-reads.utils.js';

/**
 * What each agent has been shown of each file, so a tool that changes a file can refuse text the
 * agent never saw: an edit made from memory, or from a guess, is the likeliest to be wrong. It
 * keeps the text itself, not line numbers, which go stale when anything above them changes.
 *
 * An agent is a session (the main agent, or one sub-agent): what the parent saw does not count for
 * a child, nor the other way round, since each works from what it was shown. One instance is shared
 * by the file tools of a run (the coding extension makes it); a test makes its own. Files are
 * named by their real path, as the coding tools key their `KeyedLocks`.
 *
 * Each view carries a hash of the whole file as it was then. A tool that has the file's current
 * text under its lock asks `forgetIfChanged` with that text's hash: a file that changed since
 * (by a command, the user or another agent) is forgotten, so the next edit needs a new read, and
 * a file that did not change keeps its reads, so nothing is read twice for nothing.
 */
export class FileReads {
  /** What each agent was shown, by the file's real path, then by agent. */
  readonly #seen = new Map<string, Map<SessionId, FileView>>();
  /** When each view was last read, written or edited, so what is kept is what was touched last. */
  readonly #touched = new WeakMap<FileView, number>();
  /**
   * Agents whose session was released. A tool still running when that happened can finish and
   * record a read afterwards; ignoring it keeps a released agent's text from coming back. A
   * session id is never reused and a `FileReads` is not kept across a release and a restore of
   * the same id (a reopen builds a new one), so the set is only ever added to and one id costs one
   * short string. `importAgent` runs once, on a new instance, and does not consult it.
   */
  readonly #released = new Set<SessionId>();
  #clock = 0;

  /**
   * Remembers that `agent` was shown `text` of `file`: what a read returned, or all of a file the
   * agent made. `hash` is `hashText` of the whole file at that moment. `whole` when `text` is the
   * entire file, which replaces anything seen before it; a piece of a file that has changed since
   * the pieces already kept replaces them, since they describe another version.
   */
  markRead(params: {
    agentId: SessionId;
    file: string;
    text: string;
    whole: boolean;
    hash: string;
  }): void {
    const { agentId, file, text, whole, hash } = params;

    if (this.#released.has(agentId)) return;

    const byAgent = this.agentsFor(file);

    if (whole) {
      this.#keep({ byAgent, agentId, view: { chunks: [text], whole: true, hash } });

      return;
    }

    const earlier = byAgent.get(agentId);
    const seen = earlier?.hash === hash ? earlier : { chunks: [], whole: false, hash };

    seen.chunks.push(text);
    // Dropping the oldest never drops a whole-file read: that one is `chunks[0]` and stays.
    if (seen.chunks.length > MAX_CHUNKS_PER_FILE) seen.chunks.splice(seen.whole ? 1 : 0, 1);
    this.#keep({ byAgent, agentId, view: seen });
  }

  /**
   * Forgets what `agent` was shown of `file` when the file is no longer what it saw: `hash` is
   * `hashText` of the file's current text, read under its lock. Returns whether something was
   * forgotten, so a tool can say the file changed instead of saying it was never read.
   */
  forgetIfChanged(params: { agentId: SessionId; file: string; hash: string }): boolean {
    const { agentId, file, hash } = params;
    const byAgent = this.#seen.get(file);

    if (!byAgent || byAgent.get(agentId)?.hash === hash || !byAgent.has(agentId)) return false;

    byAgent.delete(agentId);
    if (byAgent.size === 0) this.#seen.delete(file);

    return true;
  }

  /** Whether `agent` was shown anything of `file`. */
  hasRead(params: { agentId: SessionId; file: string }): boolean {
    return this.#seen.get(params.file)?.has(params.agentId) ?? false;
  }

  /** Whether some read showed `agentId` the whole of `file`. */
  hasReadWhole(params: { agentId: SessionId; file: string }): boolean {
    return this.#seen.get(params.file)?.get(params.agentId)?.whole ?? false;
  }

  /** Whether `text` is inside one piece of `file` that `agentId` was shown. */
  hasSeen(params: { agentId: SessionId; file: string; text: string }): boolean {
    const { text } = params;
    const seen = this.#seen.get(params.file)?.get(params.agentId);

    return seen?.chunks.some((chunk) => chunk.includes(text)) ?? false;
  }

  /**
   * Keeps what `agent` saw in step with an edit it made: the replaced text is now `newText` in
   * every piece that held it, so the agent can edit that place again without reading it back.
   * `hash` is `hashText` of the file as the edit left it. Other agents' views of the file are
   * left as they were: their hash no longer matches, so their next edit asks for a new read.
   */
  markEdited(params: {
    agentId: SessionId;
    file: string;
    oldText: string;
    newText: string;
    replaceAll: boolean;
    hash: string;
  }): void {
    const { oldText, newText, replaceAll, hash } = params;
    const seen = this.#seen.get(params.file)?.get(params.agentId);

    if (!seen) return;

    seen.hash = hash;
    seen.chunks = seen.chunks.map((chunk) =>
      replaceAll ? chunk.replaceAll(oldText, () => newText) : chunk.replace(oldText, () => newText),
    );
    this.#touched.set(seen, (this.#clock += 1));
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
  exportAgent(params: { agentId: SessionId }): FileViews {
    const own = [...this.#seen]
      .flatMap(([file, byAgent]) => {
        const seen = byAgent.get(params.agentId);

        return seen ? [{ file, seen, at: this.#touched.get(seen) ?? 0 }] : [];
      })
      .sort((left, right) => right.at - left.at);
    const kept: typeof own = [];
    let chars = 0;

    for (const entry of own) {
      const size = entry.seen.chunks.reduce((total, chunk) => total + chunk.length, 0);

      // A view too big for what is left is skipped, not cut: a cut one would claim text it lacks.
      if (kept.length >= MAX_PERSISTED_FILES || chars + size > MAX_PERSISTED_CHARS) continue;
      kept.push(entry);
      chars += size;
    }

    // Oldest first, so `importAgent` touches them in the order they were touched.
    const views: FileViews = {};

    for (const { file, seen } of kept.reverse()) {
      views[file] = { chunks: [...seen.chunks], whole: seen.whole, hash: seen.hash };
    }

    return views;
  }

  /**
   * Gives `agent` the views a reopened conversation kept. They are not trusted to still hold: each
   * carries the hash of the file when it was read, so the next edit or delete compares it with the
   * file now and asks for a new read if the file changed in the meantime. A whole-file view whose
   * text does not hash to its own hash is damaged or forged and is left out; a partial view cannot
   * be checked this way, since it holds only pieces of the file.
   */
  importAgent(params: { agentId: SessionId; views: FileViews }): void {
    for (const [file, view] of Object.entries(params.views)) {
      if (view.whole && hashText(view.chunks[0] ?? '') !== view.hash) continue;

      this.#keep({
        byAgent: this.agentsFor(file),
        agentId: params.agentId,
        view: { chunks: [...view.chunks], whole: view.whole, hash: view.hash },
      });
    }
  }

  /** Stores `view` for `agent` and notes it was just touched. */
  #keep(params: { byAgent: Map<SessionId, FileView>; agentId: SessionId; view: FileView }): void {
    const { byAgent, agentId, view } = params;

    byAgent.set(agentId, view);
    this.#touched.set(view, (this.#clock += 1));
  }

  /**
   * Forgets what one agent was shown, when its session is released, and ignores any read it
   * records afterwards (a tool call still running at that moment).
   */
  forgetAgent(params: { agentId: SessionId }): void {
    this.#released.add(params.agentId);

    for (const [file, byAgent] of this.#seen) {
      byAgent.delete(params.agentId);
      if (byAgent.size === 0) this.#seen.delete(file);
    }
  }

  private agentsFor(file: string): Map<SessionId, FileView> {
    const byAgent = this.#seen.get(file) ?? new Map<SessionId, FileView>();

    this.#seen.set(file, byAgent);

    return byAgent;
  }
}
