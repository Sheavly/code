/**
 * A command line is split into words and run WITHOUT a shell, so what a shell would do with a
 * character (expand `$HOME`, redirect, start a subshell) can't happen behind the user's back.
 * The line may chain commands with `|`, `&&`, `||` and `;`; each is checked on its own. What the
 * parser can't carry out faithfully is refused, not guessed at. The entry format is described in
 * `allow-list.constants.ts`.
 */
import type {
  CommandStep,
  Connector,
  ParseResult,
  Token,
  TokenResult,
} from './allow-list.types.js';

// Characters a shell gives a meaning this parser does not; each is refused outside quotes.
const REFUSED: Record<string, string> = {
  '<': 'redirects (< >)',
  '>': 'redirects (< >)',
  '(': 'subshells and parentheses',
  ')': 'subshells and parentheses',
  $: 'variables and substitution ($)',
  '`': 'backticks',
  '\\': 'backslash escapes (quote the word instead)',
  '\n': 'newlines (join commands with ; && || or |)',
  '\r': 'newlines (join commands with ; && || or |)',
};
const NOT_SUPPORTED = ' are not supported';

type Quoted = { ok: true; text: string; next: number } | { ok: false; reason: string };
type Operator = { connector: Connector; length: number } | { error: string } | undefined;

/** The text between the quote at `start` and its pair; in double quotes `$`, `` ` `` and `\` are refused. */
function readQuoted(params: { line: string; start: number }): Quoted {
  const { line, start } = params;
  const quote = line.charAt(start);
  const end = line.indexOf(quote, start + 1);

  if (end === -1) return { ok: false, reason: 'unbalanced quotes' };

  const text = line.slice(start + 1, end);
  // Single quotes are literal, as in a shell. In double quotes a shell would expand these, which
  // no shell runs here, so the word would not mean what the writer expects.
  const expanded = quote === '"' ? /[$`\\]/.exec(text)?.[0] : undefined;

  if (expanded !== undefined) {
    const what = REFUSED[expanded] ?? expanded;

    return { ok: false, reason: `${what} inside double quotes${NOT_SUPPORTED}; use single quotes` };
  }

  return { ok: true, text, next: end + 1 };
}

/** What the character at `index` is outside quotes, when it is not part of a word. */
function readOperator(params: { line: string; index: number }): Operator {
  const { line, index } = params;
  const char = line.charAt(index);
  const refused = REFUSED[char];

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

function stepOf(params: { words: string[]; joinedBy?: Connector }): CommandStep | undefined {
  const [program, ...args] = params.words;

  if (program === undefined) return undefined;

  return params.joinedBy === undefined
    ? { argv: [program, ...args] }
    : { argv: [program, ...args], joinedBy: params.joinedBy };
}

function buildSteps(readTokens: Token[]): ParseResult {
  const tokens = withoutTrailingSemicolon(readTokens);
  const steps: CommandStep[] = [];
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

/** True if `argv` matches one allow-list entry. */
export function matchesEntry(params: { argv: readonly string[]; entry: string }): boolean {
  const { argv, entry } = params;
  const words = entry.trim().split(/\s+/);
  const wildcard = words.at(-1) === '*';
  const fixed = wildcard ? words.slice(0, -1) : words;

  if (wildcard ? argv.length < fixed.length : argv.length !== fixed.length) return false;

  return fixed.every((word, i) => argv[i] === word);
}

export function isAllowed(params: {
  argv: readonly string[];
  allowList: readonly string[];
}): boolean {
  const { argv, allowList } = params;

  return allowList.some((entry) => matchesEntry({ argv, entry }));
}
