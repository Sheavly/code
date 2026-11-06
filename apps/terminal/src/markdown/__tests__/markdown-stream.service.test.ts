import { describe, expect, it } from 'vitest';
import { MarkdownStream } from '../markdown-stream.service.js';

/** Marks each line of a block, so a test sees which lines were rendered together. */
const mark = (markdown: string): string[] => markdown.split('\n').map((line) => `«${line}»`);

const stream = () => new MarkdownStream(mark);

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

  it('keeps blank lines inside a code fence with the code', () => {
    const markdown = stream();

    expect(markdown.push('```ts\nconst a = 1;\n\nconst b = 2;\n')).toBe('');
    expect(markdown.pending).toBe('```ts\nconst a = 1;\n\nconst b = 2;');
    expect(markdown.push('```\n')).toBe('«```ts»\n«const a = 1;»\n«»\n«const b = 2;»\n«```»\n');
  });

  it('closes a fence only with a marker as long as the one that opened it', () => {
    const markdown = stream();

    expect(markdown.push('````\n```\ninner\n```\n')).toBe('');
    expect(markdown.push('````\n')).toBe('«````»\n«```»\n«inner»\n«```»\n«````»\n');
  });

  it('ends the paragraph before an opening fence', () => {
    const markdown = stream();

    expect(markdown.push('Run this:\n```sh\nnpm test\n```\n')).toBe(
      '«Run this:»\n«```sh»\n«npm test»\n«```»\n',
    );
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

  it('flushes a fence that never closed', () => {
    const markdown = stream();

    markdown.push('```\nunfinished\n');

    expect(markdown.flush()).toBe('«```»\n«unfinished»\n');
    expect(markdown.push('after\n\n')).toBe('«after»\n\n');
  });
});
