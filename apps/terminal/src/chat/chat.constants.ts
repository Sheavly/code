/** What `/help` prints. */
export const CHAT_HELP = `Type a message and press Enter to send it. The conversation keeps its history.
Ctrl+C stops the running prompt (Ctrl+C again quickly to force quit).
/model lists the models of your profile; /model <name> switches to one from the next prompt on.
Tab after / lists the skills (and these commands); type more to narrow them.
/<skill> anywhere in a message runs that skill with the message, e.g. "/git submit" or "review this /review".
/exit or Ctrl+D ends the conversation and stops what it started.`;

/** A line that is one of these ends the chat. */
export const EXIT_COMMANDS = ['/exit', '/quit'];

/** The chat's own commands, offered by Tab completion at the start of a line. */
export const CHAT_COMMANDS = ['/exit', '/help', '/model', '/quit'];
