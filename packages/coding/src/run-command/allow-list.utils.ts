/**
 * A command line is split into words and run WITHOUT a shell, so what a shell would do with a
 * character (expand `$HOME`, redirect, start a subshell) can't happen behind the user's back.
 * The line may chain commands with `|`, `&&`, `||` and `;`; each is checked on its own. What the
 * parser can't carry out faithfully is refused, not guessed at. The entry format is described in
 * `allow-list.constants.ts`.
 */
import type { Connector, ScriptStep } from '@sheavly/workspace/process/process.types';
import type { ParseResult, Token, TokenResult } from './allow-list.types.js';
import { allowEntryBase, commandBase } from './command-base.utils.js';

// Characters a shell gives a meaning this parser does not; each is refused outside quotes.
const REFUSED: Record<string, string> = {
  '<': 'redirects (< >)',
  '>': 'redirects (< >)',
  '(': 'subshells and parentheses',
  ')': 'subshells and parentheses',
  $: 'variables and substitution ($)',
  '`': 'backticks',
  '\n': 'newlines (join commands with ; && || or |)',
  '\r': 'newlines (join commands with ; && || or |)',
};
const NOT_SUPPORTED = ' are not supported';

type Quoted = { ok: true; text: string; next: number } | { ok: false; reason: string };
type Operator = { connector: Connector; length: number } | { error: string } | undefined;

// What a POSIX shell lets a backslash escape inside double quotes; before any other character the
// backslash is literal (`"a\|b"` is the text `a\|b`).
const ESCAPABLE_IN_DOUBLE_QUOTES = new Set(['$', '`', '"', '\\']);

/** The text between the quote at `start` and its pair; single quotes are literal, as in a shell. */
function readQuoted(params: { line: string; start: number }): Quoted {
  const { line, start } = params;

  if (line.charAt(start) === '"') return readDoubleQuoted({ line, start });

  const end = line.indexOf("'", start + 1);

  return end === -1
    ? { ok: false, reason: 'unbalanced quotes' }
    : { ok: true, text: line.slice(start + 1, end), next: end + 1 };
}

/**
 * Reads a double-quoted word the way `sh` does: a backslash escapes only `$`, `` ` ``, `"` and
 * `\`, and is literal before anything else. An unescaped `$` or backtick would be expanded by a
 * shell, which none runs here, so it is refused rather than passed on as text.
 */
function readDoubleQuoted(params: { line: string; start: number }): Quoted {
  const { line, start } = params;
  let text = '';
  let index = start + 1;

  while (index < line.length) {
    const char = line.charAt(index);
    const after = line.charAt(index + 1);

    if (char === '"') return { ok: true, text, next: index + 1 };

    if (char === '$' || char === '`') {
      return { ok: false, reason: expansionAdvice({ line, start, char }) };
    }

    if (char === '\\' && after === '\n') {
      return { ok: false, reason: `a backslash before a newline${NOT_SUPPORTED}` };
    }

    const escapes = char === '\\' && ESCAPABLE_IN_DOUBLE_QUOTES.has(after);

    text += escapes ? after : char;
    index += escapes ? 2 : 1;
  }

  return { ok: false, reason: 'unbalanced quotes' };
}

/** Names the character a shell would expand and shows the word in single quotes, where it is text. */
function expansionAdvice(params: { line: string; start: number; char: string }): string {
  const { line, start, char } = params;
  const what = char === '$' ? 'variables and substitution ($)' : 'backticks';
  const close = line.indexOf('"', start + 1);
  const inner = close === -1 ? '' : line.slice(start + 1, close);
  const cannotRewrite = inner === '' || /['\\]/.test(inner);
  const rewrite = cannotRewrite ? '' : `, e.g. '${inner}'`;

  return `${what} inside double quotes${NOT_SUPPORTED}: \`${char}\` is not expanded here. Use single quotes for the literal text${rewrite}`;
}

/** The word around `index`, shown in single quotes when that can say it. */
function singleQuoteAdvice(params: { line: string; index: number }): string {
  const { line, index } = params;
  let from = index;
  let to = index + 1;

  // A shell reads `\|` as one escaped character, so the word runs across it.
  const ends = (at: number) => /[\s;&|]/.test(line.charAt(at)) && line.charAt(at - 1) !== '\\';

  while (from > 0 && !ends(from - 1)) from--;
  while (to < line.length && !ends(to)) to++;

  const word = line.slice(from, to);

  return /['"]/.test(word) ? '' : `, e.g. '${word}'`;
}

/** What the character at `index` is outside quotes, when it is not part of a word. */
function readOperator(params: { line: string; index: number }): Operator {
  const { line, index } = params;
  const char = line.charAt(index);
  const refused = REFUSED[char];

  if (char === '\\') {
    return {
      error:
        'a backslash outside quotes is not supported (a shell would drop it: `\\|` is `|`). ' +
        `To pass it to the program as written, put the word in single quotes${singleQuoteAdvice({ line, index })}`,
    };
  }

  if (refused !== undefined) return { error: `${refused}${NOT_SUPPORTED}` };
  if (char === ';') return { connector: ';', length: 1 };

  const pair = line.slice(index, index + 2);

  if (pair === '&&' || pair === '||') return { connector: pair, length: 2 };
  if (char === '|') return { connector: '|', length: 1 };
  if (char === '&') return { error: `a lone & (background jobs)${NOT_SUPPORTED}` };

  return undefined;
}

/** A piece of the line, read at one position: text for a word, a gap between words, or a connector. */
type Piece =
  | { kind: 'text'; text: string; length: number }
  | { kind: 'gap'; length: number }
  | { kind: 'connector'; connector: Connector; length: number }
  | { error: string };

function readPiece(params: { line: string; index: number }): Piece {
  const { line, index } = params;
  const char = line.charAt(index);

  if (char === '"' || char === "'") {
    const quoted = readQuoted({ line, start: index });

    return quoted.ok
      ? { kind: 'text', text: quoted.text, length: quoted.next - index }
      : { error: quoted.reason };
  }

  if (char === ' ' || char === '\t') return { kind: 'gap', length: 1 };

  const operator = readOperator({ line, index });

  if (!operator) return { kind: 'text', text: char, length: 1 };

  return 'error' in operator ? operator : { kind: 'connector', ...operator };
}

/** Splits a line into words (quotes removed) and the connectors between commands. */
function tokenize(line: string): TokenResult {
  const tokens: Token[] = [];
  let word: string | undefined;
  let index = 0;

  const endWord = () => {
    if (word !== undefined) tokens.push({ word });
    word = undefined;
  };

  while (index < line.length) {
    const piece = readPiece({ line, index });

    if ('error' in piece) return { ok: false, reason: piece.error };
    index += piece.length;

    if (piece.kind === 'text') {
      word = (word ?? '') + piece.text;
      continue;
    }

    endWord();
    if (piece.kind === 'connector') tokens.push({ connector: piece.connector });
  }

  endWord();

  return { ok: true, tokens };
}

function stepOf(params: { words: string[]; joinedBy?: Connector }): ScriptStep | undefined {
  const [program, ...args] = params.words;

  if (program === undefined) return undefined;

  return params.joinedBy === undefined
    ? { argv: [program, ...args] }
    : { argv: [program, ...args], joinedBy: params.joinedBy };
}

function buildSteps(readTokens: Token[]): ParseResult {
  const tokens = withoutTrailingSemicolon(readTokens);
  const steps: ScriptStep[] = [];
  let words: string[] = [];

  for (const token of tokens) {
    if ('word' in token) {
      words.push(token.word);
      continue;
    }

    const step = stepOf({ words, joinedBy: token.connector });

    if (!step) return { ok: false, reason: `\`${token.connector}\` needs a command before it` };
    steps.push(step);
    words = [];
  }

  const last = stepOf({ words });

  if (last) steps.push(last);
  else if (steps.length > 0) {
    return {
      ok: false,
      reason: `the line ends with \`${steps.at(-1)?.joinedBy}\`, with no command after it`,
    };
  }

  const [first, ...rest] = steps;

  return first ? { ok: true, steps: [first, ...rest] } : { ok: false, reason: 'empty command' };
}

// A trailing `;` ends the last command, as in a shell. Any other connector lacks its right side.
function withoutTrailingSemicolon(tokens: Token[]): Token[] {
  const last = tokens.at(-1);

  return last && 'connector' in last && last.connector === ';' ? tokens.slice(0, -1) : tokens;
}

/** Splits a command line into its commands; quotes group words, and `$`, redirects and the like are refused. */
export function parseCommand(line: string): ParseResult {
  const read = tokenize(line);

  return read.ok ? buildSteps(read.tokens) : read;
}

/** Grants match only command identity, including legacy entries. Options and operands are ignored. */
export function matchesEntry(params: { argv: readonly string[]; entry: string }): boolean {
  const { argv, entry } = params;
  const approved = allowEntryBase(entry);
  const actual = commandBase(argv);

  return approved.length > 0 && approved.every((word, index) => actual[index] === word);
}

export function isAllowed(params: {
  argv: readonly string[];
  allowList: readonly string[];
}): boolean {
  const { argv, allowList } = params;

  return allowList.some((entry) => matchesEntry({ argv, entry }));
}
