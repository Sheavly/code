/**
 * What the user typed at the chat prompt: a line to send, a command (`/exit`, `/help`,
 * `/model [name]`), or nothing. Commands start with `/`; everything else is sent as it is, trimmed.
 */
export type ChatInput =
  | { kind: 'prompt'; text: string }
  | { kind: 'exit' }
  | { kind: 'help' }
  /** `/model` lists the models; `/model <name>` switches to one. */
  | { kind: 'model'; name: string | undefined }
  | { kind: 'empty' }
  | { kind: 'unknown'; command: string };
