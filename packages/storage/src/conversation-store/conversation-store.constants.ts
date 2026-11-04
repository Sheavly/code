/** The folder under a workspace's folder that holds its conversations, one folder each. */
export const CONVERSATIONS_FOLDER = 'conversations';

/** A conversation's index entry, inside its folder. */
export const INDEX_FILE = 'index.json';

/** A conversation's stream, one entry per line, in `seq` order. */
export const STREAM_FILE = 'stream.jsonl';

/** The conversation's own history, the main session's. */
export const HISTORY_FILE = 'history.json';

/** The folder in a conversation's folder that holds each sub-agent's history. */
export const AGENTS_FOLDER = 'agents';

/** A sub-agent's history is `agents/<session-id>.history.json`. */
export const AGENT_HISTORY_SUFFIX = '.history.json';
