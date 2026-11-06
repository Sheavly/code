import { describe, expect, it } from 'vitest';
import { MarkdownStream } from '../markdown-stream.service.js';

/** Marks each line of a block, so a test sees which lines were rendered together. */
const mark = (markdown: string): string[] => markdown.split('\n').map((line) => `«${line}»`);

/** Draws a code block with marks of its own, so a test sees each line when it is drawn. */
const drawFence = (info: string) => ({
  open: () => [`⌈${info}`],
  line: (code: string) => [`│${code}`],
  close: () => ['⌋'],
});

const stream = () => new MarkdownStream({ render: mark, drawFence });

describe('MarkdownStream', () => {
  it('holds a paragraph back until a blank line ends it', () => {
    const markdown = stream();

    expect(markdown.push('first line\nsecond ')).toBe('');
    expect(markdown.pending).toBe('first line\nsecond ');
    expect(markdown.push('line\n')).toBe('');
    expect(markdown.push('\n')).toBe('«first line»\n«second line»\n\n');
    expect(markdown.pending).toBe('');
  });

  it('keeps the blank lines between blocks as they were written', () => {
    const markdown = stream();

    expect(markdown.push('one\n\n\n\ntwo\n\n')).toBe('«one»\n\n\n\n«two»\n\n');
  });

  it('holds a table back until its block ends, so a new row can still change it', () => {
    const markdown = stream();

    expect(markdown.push('| a | b |\n|---|---|\n| 1 | 2 |\n')).toBe('');
    expect(markdown.push('| 3 | 4 |\n')).toBe('');
    expect(markdown.push('\n')).toBe('«| a | b |»\n«|---|---|»\n«| 1 | 2 |»\n«| 3 | 4 |»\n\n');
  });

  it('draws the lines of a code fence as they arrive, blank ones too', () => {
    const markdown = stream();

    expect(markdown.push('```ts\nconst a = 1;\n')).toBe('⌈ts\n│const a = 1;\n');
    expect(markdown.push('\nconst b')).toBe('│\n');
    expect(markdown.pending).toBe('const b');
    expect(markdown.push(' = 2;\n```\n')).toBe('│const b = 2;\n⌋\n');
    expect(markdown.pending).toBe('');
  });

  it('closes a fence only with a marker as long as the one that opened it', () => {
    const markdown = stream();

    expect(markdown.push('````\n```\ninner\n')).toBe('⌈\n│```\n│inner\n');
    expect(markdown.push('```\n')).toBe('│```\n');
    expect(markdown.push('````\n')).toBe('⌋\n');
  });

  it('closes a tilde fence only with tildes', () => {
    const markdown = stream();

    expect(markdown.push('~~~\n```\n~~~\n')).toBe('⌈\n│```\n⌋\n');
  });

  it('ends the paragraph before an opening fence', () => {
    const markdown = stream();

    expect(markdown.push('Run this:\n```sh\nnpm test\n```\n')).toBe(
      '«Run this:»\n⌈sh\n│npm test\n⌋\n',
    );
  });

  it('takes the whole info text of a fence, and takes a line of inline code for no fence', () => {
    const markdown = stream();

    expect(markdown.push('```json title="a"\n')).toBe('⌈json title="a"\n');
    expect(markdown.push('```\n')).toBe('⌋\n');
    expect(markdown.push('```code``` is inline\n\n')).toBe('«```code``` is inline»\n\n');
  });

  it('removes the indent of a fence from its code, as much as each line has', () => {
    const markdown = stream();

    expect(markdown.push('  ```\n  a\n    b\n c\nd\n  ```\n')).toBe('⌈\n│a\n│  b\n│c\n│d\n⌋\n');
  });

  it('reads a line split across pushes as one line', () => {
    const markdown = stream();

    expect(markdown.push('hel')).toBe('');
    expect(markdown.push('lo\n\r')).toBe('');
    expect(markdown.push('\n')).toBe('«hello»\n\n');
  });

  it('flushes the block being written, and its newline only when the text had one', () => {
    const open = stream();
    const closed = stream();

    open.push('a paragraph still being wr');
    closed.push('a finished line\n');

    expect(open.flush()).toBe('«a paragraph still being wr»');
    expect(closed.flush()).toBe('«a finished line»\n');
    expect(open.pending).toBe('');
    expect(closed.flush()).toBe('');
  });

  it('closes a fence that never closed when it is flushed', () => {
    const markdown = stream();

    markdown.push('```\nunfinished\n');

    expect(markdown.flush()).toBe('⌋\n');
    expect(markdown.push('after\n\n')).toBe('«after»\n\n');
  });

  it('draws the code line that was being written before closing a fence', () => {
    const markdown = stream();

    markdown.push('```\nhalf a li');

    expect(markdown.flush()).toBe('│half a li\n⌋');
  });
});
