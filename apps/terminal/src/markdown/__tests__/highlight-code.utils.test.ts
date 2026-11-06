import { describe, expect, it } from 'vitest';
import { languageFor } from '../code-languages.utils.js';
import { highlightCode, highlightLine } from '../highlight-code.utils.js';
import type { CodePaint, HighlightState } from '../markdown.types.js';

/** Tags each painted part with its kind, so a test reads what was told apart. */
const paint: CodePaint = {
  keyword: (text) => `<k>${text}</k>`,
  string: (text) => `<s>${text}</s>`,
  number: (text) => `<n>${text}</n>`,
  comment: (text) => `<c>${text}</c>`,
};

const script = (code: string) => highlightCode({ code, lang: 'ts', paint });

describe('highlightCode', () => {
  it('tells keywords, strings, numbers and comments apart and leaves the rest', () => {
    expect(script('const name = "a\\"b" + 42; // done')).toEqual([
      '<k>const</k> name = <s>"a\\"b"</s> + <n>42</n>; <c>// done</c>',
    ]);
  });

  it('does not take the word inside a longer one for a keyword or a number', () => {
    expect(script('constant x1 = of2')).toEqual(['constant x1 = of2']);
  });

  it('keeps a block comment and a template string painted over several lines', () => {
    expect(script('/* one\n two */ let a = `x\ny` + 1')).toEqual([
      '<c>/* one</c>',
      '<c> two */</c> <k>let</k> a = <s>`x</s>',
      '<s>y`</s> + <n>1</n>',
    ]);
  });

  it('ends an unclosed single-line string at the end of its line', () => {
    expect(script('a = "open\nb = 1')).toEqual(['a = <s>"open</s>', 'b = <n>1</n>']);
  });

  it('does not take `//` in an address, or `#` in a word, for a comment', () => {
    expect(script('fetch("x"); url = http://a')).toEqual(['fetch(<s>"x"</s>); url = http://a']);
    expect(highlightCode({ code: 'echo $#  # note', lang: 'sh', paint })).toEqual([
      'echo $#  <c># note</c>',
    ]);
  });

  it('reads python triple quotes and hash comments', () => {
    expect(highlightCode({ code: 'x = """a\nb"""\n# c', lang: 'python', paint })).toEqual([
      'x = <s>"""a</s>',
      '<s>b"""</s>',
      '<c># c</c>',
    ]);
  });

  it('reads json literals and numbers', () => {
    expect(highlightCode({ code: '{"a": [1.5e3, null]}', lang: 'JSON', paint })).toEqual([
      '{<s>"a"</s>: [<n>1.5e3</n>, <k>null</k>]}',
    ]);
  });

  it('leaves code of an unknown or missing language as written', () => {
    expect(highlightCode({ code: 'const a = 1', lang: 'cobol', paint })).toEqual(['const a = 1']);
    expect(highlightCode({ code: 'const a = 1', lang: undefined, paint })).toEqual(['const a = 1']);
  });

  it('does not treat a name from the object prototype as a language', () => {
    expect(languageFor('constructor')).toBeUndefined();
    expect(languageFor('toString')).toBeUndefined();
  });
});

describe('highlightLine', () => {
  it('returns where the next line starts', () => {
    const language = languageFor('ts');
    const state: HighlightState = undefined;

    if (language === undefined) throw new Error('ts is a language');

    expect(highlightLine({ line: 'a /* b', language, state, paint }).state).toEqual({
      style: 'comment',
      end: '*/',
    });
    expect(highlightLine({ line: 'a // b', language, state, paint }).state).toBeUndefined();
  });
});
