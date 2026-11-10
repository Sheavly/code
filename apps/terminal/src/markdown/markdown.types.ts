/** How the reader of a code block tells its parts apart; each returns the text styled. */
export type CodePaint = {
  keyword: (text: string) => string;
  string: (text: string) => string;
  number: (text: string) => string;
  comment: (text: string) => string;
};

/** What a language's code is made of, as far as colouring it needs to know. */
export type CodeLanguage = {
  keywords: ReadonlySet<string>;
  /** What starts a comment that runs to the end of the line (`//`, `#`). */
  lineComment: string | undefined;
  /** Whether `/* ... *\/` is a comment, which may span lines. */
  blockComments: boolean;
  /** What opens a string, longest first; the same text closes it. */
  strings: readonly string[];
  /** The openers (of `strings`) whose string goes on past the end of a line. */
  multilineStrings: readonly string[];
};

/** A `CodeLanguage` as written down: its keywords are one space-separated string. */
export type CodeLanguageSpec = Omit<CodeLanguage, 'keywords'> & { keywords: string };

/**
 * Where a line starts when an earlier one left a comment or a string open: what ends it, and
 * how its text is painted. `undefined` is ordinary code.
 */
export type HighlightState = { style: 'comment' | 'string'; end: string } | undefined;

/** The line of a code block, painted, and where the next line starts. */
export type HighlightedLine = { text: string; state: HighlightState };

/**
 * A fenced code block drawn as it is written: its opening border, each line of code as it
 * arrives, and its closing border. Each returns finished lines, wrapped to the screen's width.
 */
export type CodeFenceDrawing = {
  open: () => string[];
  line: (code: string) => string[];
  close: () => string[];
};
