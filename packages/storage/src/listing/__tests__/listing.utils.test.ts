import { describe, expect, it } from 'vitest';
import type { ListedFile } from '../listing.types.js';
import { sortByName, splitListed } from '../listing.utils.js';

const item = (id: string, name: string) => ({ id, name });

describe('sortByName', () => {
  it('orders by name, then id, and returns a new array', () => {
    const items = [item('c', 'Bora'), item('b', 'Astra'), item('a', 'Astra')];
    const sorted = sortByName(items);

    expect(sorted.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(items.map(({ id }) => id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by a fixed locale, whatever the system’s: Ä is after Z in Swedish, not in English', () => {
    const sorted = sortByName([item('1', 'zeta'), item('2', 'Ärlig'), item('3', 'apple')]);

    expect(sorted.map(({ name }) => name)).toEqual(['apple', 'Ärlig', 'zeta']);
  });

  it('puts capitals among the lowercase, not before all of them', () => {
    const sorted = sortByName([item('1', 'banana'), item('2', 'Apple'), item('3', 'cherry')]);

    expect(sorted.map(({ name }) => name)).toEqual(['Apple', 'banana', 'cherry']);
  });
});

describe('splitListed', () => {
  it('keeps the items and the problems apart, in order, and drops what was removed since', () => {
    const listed: ListedFile<string>[] = [
      { item: 'a' },
      { problem: { file: '/x/b.json', message: 'damaged' } },
      undefined,
      { item: 'c' },
    ];

    expect(splitListed(listed)).toEqual({
      items: ['a', 'c'],
      problems: [{ file: '/x/b.json', message: 'damaged' }],
    });
  });

  it('is empty for nothing', () => {
    expect(splitListed([])).toEqual({ items: [], problems: [] });
  });
});
