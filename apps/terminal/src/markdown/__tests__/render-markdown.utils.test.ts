import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../render-markdown.utils.js';

const plain = (params: { markdown: string; width?: number }): string[] =>
  renderMarkdown({ markdown: params.markdown, width: params.width ?? 40 }).map((line) =>
    stripVTControlCharacters(line),
  );

describe('renderMarkdown', () => {
  it('drops the markers of emphasis and keeps the words', () => {
    expect(plain({ markdown: 'Some **bold** and `code`' })).toEqual(['Some bold and code']);
  });

  it('styles emphasis and inline code', () => {
    const [line] = renderMarkdown({ markdown: 'a **b** `c`', width: 40 });

    expect(line).toContain('\u001b[1mb');
    expect(line).not.toBe(stripVTControlCharacters(line ?? ''));
  });

  it('draws a list with its markers', () => {
    expect(plain({ markdown: '- one\n- two\n  - nested' })).toEqual([
      '- one',
      '- two',
      '    - nested',
    ]);
  });

  it('keeps the number a list starts at', () => {
    expect(plain({ markdown: '2. two\n3. three' })).toEqual(['2. two', '3. three']);
  });

  it('draws a table as a grid', () => {
    expect(plain({ markdown: '| a | b |\n|---|---|\n| 1 | 2 |' })).toEqual([
      '┌───┬───┐',
      '│ a │ b │',
      '├───┼───┤',
      '│ 1 │ 2 │',
      '└───┴───┘',
    ]);
  });

  it('indents the code of a fence and keeps its borders', () => {
    expect(plain({ markdown: '```ts\nconst a = 1;\n```' })).toEqual([
      '```ts',
      '  const a = 1;',
      '```',
    ]);
  });

  it('wraps a paragraph to the width, with no padding to fill the line', () => {
    const lines = plain({
      markdown: 'a long paragraph that must wrap because it is longer than the width',
      width: 20,
    });

    expect(lines.length).toBeGreaterThan(1);

    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
      expect(line).toBe(line.trimEnd());
    }
  });
});
