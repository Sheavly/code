/** What one agent has been shown of one file. */
export type FileView = {
  /** Pieces of the file as shown, kept in step with the agent's own edits. */
  chunks: string[];
  /** Some read showed the whole file. */
  whole: boolean;
  /** `hashText` of the whole file as the agent last saw it or left it by its own edit. */
  hash: string;
};

/** An agent's views by the file's real path: what is kept with a conversation and restored on reopen. */
export type FileViews = Record<string, FileView>;
