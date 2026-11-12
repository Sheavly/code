import { describe, expect, it } from 'vitest';
import { entriesOf, formatEntry, mergeEntries } from '../entries.utils.js';

describe('entries', () => {
  it('indents a multi-line entry so its text cannot pass for the next entry', () => {
    const text = formatEntry('first line\n- looks like an entry\nlast');

    expect(text).toBe('- first line\n  - looks like an entry\n  last');
    expect(entriesOf(text)).toEqual([text]);
  });

  it('reads back what it wrote, oldest first, and nothing from empty text', () => {
    const text = [formatEntry('a'), formatEntry('b')].join('\n');

    expect(entriesOf(text)).toEqual(['- a', '- b']);
    expect(entriesOf(undefined)).toEqual([]);
    expect(entriesOf('')).toEqual([]);
  });
});

describe('mergeEntries', () => {
  it('adds the new entries after the previous ones', () => {
    expect(mergeEntries({ previous: '- a', added: ['b', 'c'], maxChars: 100 })).toBe(
      '- a\n- b\n- c',
    );
  });

  it('keeps a repeated entry once, at its newest place', () => {
    expect(mergeEntries({ previous: '- a\n- b', added: ['a'], maxChars: 100 })).toBe('- b\n- a');
  });

  it('drops the oldest entries first when the text does not fit', () => {
    const merged = mergeEntries({ previous: '- aaaa\n- bbbb', added: ['cccc'], maxChars: 13 });

    expect(merged).toBe('- bbbb\n- cccc');
    expect(merged.length).toBeLessThanOrEqual(13);
  });

  it('cuts and marks the newest entry when it alone is too long, never dropping it whole', () => {
    const merged = mergeEntries({ previous: '- old', added: ['x'.repeat(50)], maxChars: 10 });

    expect(merged).toBe(`- ${'x'.repeat(7)}…`);
    expect(merged.length).toBe(10);
  });

  it('keeps pinned leading entries whole and drops from the middle when the text does not fit', () => {
    const merged = mergeEntries({
      previous: '- rule\n- aaaa\n- bbbb',
      added: ['cccc'],
      maxChars: 20,
      pin: 1,
    });

    expect(merged).toBe('- rule\n- bbbb\n- cccc');
    expect(merged.length).toBeLessThanOrEqual(20);
  });

  it('pins the first added entry when there is no previous text, and never repeats it', () => {
    const merged = mergeEntries({
      previous: undefined,
      added: ['rule', 'x', 'rule'],
      maxChars: 100,
      pin: 1,
    });

    expect(merged).toBe('- rule\n- x');
  });

  it('cuts a pinned entry that alone is longer than the section, and keeps nothing else', () => {
    const merged = mergeEntries({
      previous: undefined,
      added: ['r'.repeat(50), 'new'],
      maxChars: 10,
      pin: 1,
    });

    expect(merged).toBe(`- ${'r'.repeat(7)}…`);
  });

  it('returns an empty string when there is nothing', () => {
    expect(mergeEntries({ previous: undefined, added: [], maxChars: 10 })).toBe('');
  });
});
