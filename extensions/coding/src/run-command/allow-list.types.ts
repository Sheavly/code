import type { Connector, ScriptStep } from '@sheavly/process/process/process.types';

/** A command line split into its commands, or why it can't be. */
export type ParseResult =
  { ok: true; steps: [ScriptStep, ...ScriptStep[]] } | { ok: false; reason: string };

/** What the tokenizer reads: a word (quotes removed) or a connector between commands. */
export type Token = { word: string } | { connector: Connector };

/** The tokens of a line, or why it can't be read. */
export type TokenResult = { ok: true; tokens: Token[] } | { ok: false; reason: string };
