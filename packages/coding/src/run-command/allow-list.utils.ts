/**
 * Commands are split into words and run WITHOUT a shell when the allow list is on,
 * so `git status; rm -rf /` can't sneak past an entry for `git status`.
 * Shell syntax (; & | < > ` $ ( ) newlines) is rejected outright.
 * The entry format is described in `allow-list.constants.ts`.
 */
import type { ParseResult } from './allow-list.types.js';

const SHELL_SYNTAX = /[;&|<>`$()\r\n]/;

/** Splits a command into words, honouring "double" and 'single' quotes. */
export function parseCommand(command: string): ParseResult {
  if (SHELL_SYNTAX.test(command)) {
    return { ok: false, reason: 'shell syntax (; & | < > ` $ ( ) or newlines) is not allowed' };
  }

  if ((command.match(/"/g)?.length ?? 0) % 2 || (command.match(/'/g)?.length ?? 0) % 2) {
    return { ok: false, reason: 'unbalanced quotes' };
  }

  const argv = [...command.matchAll(/"([^"]*)"|'([^']*)'|[^\s"']+/g)].map(
    (m) => m[1] ?? m[2] ?? m[0],
  );

  return argv.length > 0 ? { ok: true, argv } : { ok: false, reason: 'empty command' };
}

/** True if `argv` matches one allow-list entry. */
export function matchesEntry(params: { argv: string[]; entry: string }): boolean {
  const { argv, entry } = params;
  const words = entry.trim().split(/\s+/);
  const wildcard = words.at(-1) === '*';
  const fixed = wildcard ? words.slice(0, -1) : words;

  if (wildcard ? argv.length < fixed.length : argv.length !== fixed.length) return false;

  return fixed.every((word, i) => argv[i] === word);
}

export function isAllowed(params: { argv: string[]; allowList: readonly string[] }): boolean {
  const { argv, allowList } = params;

  return allowList.some((entry) => matchesEntry({ argv, entry }));
}
