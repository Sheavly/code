/** How one command of a line is joined to the next: a pipe, `&&`, `||` or `;`. */
export type Connector = '|' | '&&' | '||' | ';';

/** One simple command of a line: its words, and what joins it to the next command, if any. */
export type CommandStep = { argv: [string, ...string[]]; joinedBy?: Connector };

/** A command line split into its commands, or why it can't be. */
export type ParseResult =
  { ok: true; steps: [CommandStep, ...CommandStep[]] } | { ok: false; reason: string };

/** What the tokenizer reads: a word (quotes removed) or a connector between commands. */
export type Token = { word: string } | { connector: Connector };

/** The tokens of a line, or why it can't be read. */
export type TokenResult = { ok: true; tokens: Token[] } | { ok: false; reason: string };
