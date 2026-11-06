import { describe, expect, it } from 'vitest';
import type { ShellMark } from '../marks.types.js';
import { carryMark, restoreMarks, shellMarkSequence } from '../marks.utils.js';

describe('shellMarkSequence', () => {
  it.each([
    ['prompt', '\u001b]133;A\u001b\\\u001b]133;B\u001b\\'],
    ['output', '\u001b]133;C\u001b\\'],
    ['done', '\u001b]133;D;0\u001b\\'],
    ['failed', '\u001b]133;D;1\u001b\\'],
  ] as const)('writes %s as OSC 133', (mark, sequence) => {
    expect(shellMarkSequence(mark)).toBe(sequence);
  });
});

describe('restoreMarks', () => {
  const marks: ShellMark[] = ['prompt', 'output', 'done', 'failed'];

  it.each(marks)('turns the carried %s mark back into its sequence', (mark) => {
    expect(restoreMarks(`${carryMark(mark)}row`)).toBe(`${shellMarkSequence(mark)}row`);
  });

  it('carries each mark as a sequence of its own', () => {
    expect(new Set(marks.map(carryMark)).size).toBe(marks.length);
  });

  it('leaves styling, hyperlinks and text as they are', () => {
    const text =
      '\u001b[1mbold\u001b[0m \u001b]8;;https://a.test\u001b\\link\u001b]8;;\u001b\\ 9701';

    expect(restoreMarks(text)).toBe(text);
  });

  it('restores every mark in a frame of several rows', () => {
    const frame = `${carryMark('prompt')}one\n${carryMark('output')}\n${carryMark('done')}`;

    expect(restoreMarks(frame)).toBe(
      `${shellMarkSequence('prompt')}one\n${shellMarkSequence('output')}\n${shellMarkSequence('done')}`,
    );
  });
});
