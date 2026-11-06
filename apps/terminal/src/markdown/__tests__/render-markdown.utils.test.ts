import { stripVTControlCharacters } from 'node:util';
import { resetCapabilitiesCache, setCapabilities } from '@earendil-works/pi-tui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPalette } from '../../theme/palette.utils.js';
import { THEMES } from '../../theme/theme.constants.js';
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

  it('colours its code and highlighted blocks by the palette it is given', () => {
    const markdown = 'Use `x`\n\n```ts\nconst a = "b";\n```';
    const lines = renderMarkdown({
      markdown,
      width: 40,
      palette: createPalette(THEMES.colorblind),
    });

    expect(lines.join('\n')).toContain('\u001b[94m"b"');
    expect(lines.join('\n')).not.toContain('\u001b[32m');
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

  it('colours the code of a fence nested in a list', () => {
    const lines = renderMarkdown({ markdown: '- a\n\n  ```ts\n  const a = 1;\n  ```', width: 40 });

    expect(lines.some((line) => line.includes('\u001b[36m\u001b[1mconst'))).toBe(true);
  });

  it('adds no escape codes when plain, and writes out inline code and strike-through', () => {
    const markdown = '# Title\n\nSome **bold** `code` ~~gone~~ [a](https://x.dev)\n\n> quote';
    const lines = renderMarkdown({ markdown, width: 60, plain: true });

    expect(lines.join('\n')).toBe(
      'Title\n\nSome bold `code` ~~gone~~ a (https://x.dev)\n\n│ quote',
    );
    expect(lines.join('\n')).toBe(stripVTControlCharacters(lines.join('\n')));
  });

  describe('in a terminal that opens links', () => {
    const markdown = 'See [the docs](https://x.dev/a) now';

    beforeEach(() => setCapabilities({ images: null, trueColor: true, hyperlinks: true }));
    afterEach(() => resetCapabilitiesCache());

    it('makes a link a hyperlink on its text, without printing the address', () => {
      const [line] = renderMarkdown({ markdown, width: 60 });

      expect(line).toContain('\u001b]8;;https://x.dev/a\u001b\\');
      expect(stripVTControlCharacters(line ?? '')).toBe('See the docs now');
    });

    it('keeps one link across the rows a wrapped link takes', () => {
      const lines = renderMarkdown({ markdown: '[one two three four](https://x.dev/a)', width: 9 });

      expect(lines.length).toBeGreaterThan(1);

      for (const line of lines) expect(line).toContain('\u001b]8;;https://x.dev/a\u001b\\');
    });

    it('prints the address instead when plain, since a hyperlink would be stripped', () => {
      const lines = renderMarkdown({ markdown, width: 60, plain: true });

      expect(lines).toEqual(['See the docs (https://x.dev/a) now']);
    });

    it('gives the terminal’s setting back after a plain block', () => {
      renderMarkdown({ markdown, width: 60, plain: true });

      expect(renderMarkdown({ markdown, width: 60 })[0]).toContain('\u001b]8;;https://x.dev/a');
    });
  });

  it.each([6, 12, 20])('keeps a table within a width of %i columns', (width) => {
    const lines = plain({
      markdown:
        '| name | description |\n|---|---|\n| alpha | the first letter |\n| beta | the second |',
      width,
    });

    for (const line of lines) expect(line.length).toBeLessThanOrEqual(width);
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
