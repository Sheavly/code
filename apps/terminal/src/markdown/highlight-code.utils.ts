import { languageFor } from './code-languages.utils.js';
import { NUMBER_PATTERN, WORD_PATTERN } from './markdown.constants.js';
import type { CodeLanguage, CodePaint, HighlightedLine, HighlightState } from './markdown.types.js';

type CodeToken = {
  style: keyof CodePaint | 'plain';
  length: number;
  /** Where the text after this token starts: open when the token ran off the end of a line. */
  state: HighlightState;
};

/**
 * Paints one line of code and says where the next one starts, so a comment or a string that
 * goes on over several lines keeps its colour. It reads tokens, not grammar: good enough to tell
 * keywords, strings, numbers and comments apart, and it never changes the text.
 */
export function highlightLine(params: {
  line: string;
  language: CodeLanguage;
  state: HighlightState;
  paint: CodePaint;
}): HighlightedLine {
  const { line, language, paint } = params;
  let state = params.state;
  let at = 0;
  let text = '';

  while (at < line.length) {
    const token =
      state === undefined
        ? readCode({ line, at, language })
        : readUntil({ line, at, from: at, state, carries: true });
    const piece = line.slice(at, at + token.length);

    text += token.style === 'plain' ? piece : paint[token.style](piece);
    at += token.length;
    state = token.state;
  }

  return { text, state };
}

/** The lines of `code` painted as `lang`; untagged or unknown languages stay as written. */
export function highlightCode(params: {
  code: string;
  lang: string | undefined;
  paint: CodePaint;
}): string[] {
  const { code, lang, paint } = params;
  const language = languageFor(lang);
  const lines = code.split('\n');

  if (language === undefined) return lines;

  let state: HighlightState;
  const painted: string[] = [];

  for (const line of lines) {
    const highlighted = highlightLine({ line, language, state, paint });

    painted.push(highlighted.text);
    state = highlighted.state;
  }

  return painted;
}

/** The token that starts at `at`, outside any comment or string carried from an earlier line. */
function readCode(params: { line: string; at: number; language: CodeLanguage }): CodeToken {
  const { line, at, language } = params;

  if (startsLineComment({ line, at, marker: language.lineComment })) {
    return { style: 'comment', length: line.length - at, state: undefined };
  }

  if (language.blockComments && line.startsWith('/*', at)) {
    return readUntil({
      line,
      at,
      from: at + 2,
      state: { style: 'comment', end: '*/' },
      carries: true,
    });
  }

  const opener = language.strings.find((marker) => line.startsWith(marker, at));

  if (opener !== undefined) {
    return readUntil({
      line,
      at,
      from: at + opener.length,
      state: { style: 'string', end: opener },
      carries: language.multilineStrings.includes(opener),
    });
  }

  return readWord({ line, at, language });
}

/** A marker counts as a comment unless it is glued to a word, `:` or `$` (`https://`, `$#`). */
function startsLineComment(params: {
  line: string;
  at: number;
  marker: string | undefined;
}): boolean {
  const { line, at, marker } = params;

  return marker !== undefined && line.startsWith(marker, at) && !/[\w:$]/.test(line.charAt(at - 1));
}

/**
 * The text from `at` up to where `state` ends, or to the end of the line. `carries` says whether
 * an unfinished one goes on to the next line: a single-line string stops at the end of its line.
 */
function readUntil(params: {
  line: string;
  at: number;
  from: number;
  state: NonNullable<HighlightState>;
  carries: boolean;
}): CodeToken {
  const { line, at, from, state, carries } = params;
  const stop = findEnd({ line, from, state });

  if (stop === undefined) {
    return { style: state.style, length: line.length - at, state: carries ? state : undefined };
  }

  return { style: state.style, length: stop - at, state: undefined };
}

/** Where `state` ends in `line` from `from` on, past its closing text; strings skip `\` escapes. */
function findEnd(params: {
  line: string;
  from: number;
  state: NonNullable<HighlightState>;
}): number | undefined {
  const { line, from, state } = params;

  if (state.style === 'comment') {
    const found = line.indexOf(state.end, from);

    return found < 0 ? undefined : found + state.end.length;
  }

  for (let index = from; index < line.length; index++) {
    if (line.charAt(index) === '\\') index++;
    else if (line.startsWith(state.end, index)) return index + state.end.length;
  }

  return undefined;
}

function readWord(params: { line: string; at: number; language: CodeLanguage }): CodeToken {
  const { line, at, language } = params;
  const rest = line.slice(at);
  const number = NUMBER_PATTERN.exec(rest)?.[0];

  if (number !== undefined) return { style: 'number', length: number.length, state: undefined };

  const word = WORD_PATTERN.exec(rest)?.[0];

  if (word === undefined) return { style: 'plain', length: 1, state: undefined };

  return {
    style: language.keywords.has(word) ? 'keyword' : 'plain',
    length: word.length,
    state: undefined,
  };
}
