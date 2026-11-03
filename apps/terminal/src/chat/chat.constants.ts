/** What `/help` prints. */
export const CHAT_HELP = `Type a message and press Enter to send it. The conversation keeps its history.
Ctrl+C stops the running prompt (Ctrl+C again quickly to force quit).
/model lists the models in MODELS; /model <name> switches to one from the next prompt on.
/exit or Ctrl+D ends the conversation and stops what it started.`;

/** A line that is one of these ends the chat. */
export const EXIT_COMMANDS = ['/exit', '/quit'];
