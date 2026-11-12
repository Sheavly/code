/** The folder under a workspace's folder that holds its conversations, one folder each. */
export const CONVERSATIONS_FOLDER = 'conversations';

/** A conversation's index entry, inside its folder. */
export const INDEX_FILE = 'index.json';

/** A conversation's stream, one entry per line, in `seq` order. */
export const STREAM_FILE = 'stream.jsonl';

/** A searchable, private projection of run, hook and tool failures from the stream. */
export const ERRORS_FILE = 'errors.jsonl';

/** The conversation's own history, the main session's. */
export const HISTORY_FILE = 'history.json';

/** The main session's durable history log, one record per line, in `seq` order. */
export const HISTORY_LOG_FILE = 'history.jsonl';

/** A sub-agent's durable history log is `agents/<session-id>.history.jsonl`. */
export const AGENT_HISTORY_LOG_SUFFIX = '.history.jsonl';

/** Where the conversation's agents work from, shared by the main session and its sub-agents. */
export const SHELL_FILE = 'shell.json';

/** The folder in a conversation's folder that holds its complete command output logs. */
export const OUTPUTS_FOLDER = 'outputs';

/** The lines queued behind a running prompt: outside history, kept across a restart. */
export const QUEUE_FILE = 'queue.json';

/** The folder in a conversation's folder that holds each sub-agent's history. */
export const AGENTS_FOLDER = 'agents';

/** A sub-agent's history is `agents/<session-id>.history.json`. */
export const AGENT_HISTORY_SUFFIX = '.history.json';
