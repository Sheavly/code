import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInside } from '../workspace.utils.js';

const folder = path.join(path.sep, 'repo');

describe('isInside', () => {
  it.each([
    ['the folder itself', folder],
    ['a file in it', path.join(folder, 'a.ts')],
    ['a nested file', path.join(folder, 'src', 'a.ts')],
    ['a folder whose name starts with dots', path.join(folder, '..x', 'a.ts')],
  ])('counts %s as inside', (_, target) => {
    expect(isInside({ folder, target })).toBe(true);
  });

  it.each([
    ['the parent', path.dirname(folder)],
    ['a sibling', path.join(path.sep, 'other', 'a.ts')],
    ['a sibling sharing its prefix', path.join(path.sep, 'repo-x', 'a.ts')],
  ])('counts %s as outside', (_, target) => {
    expect(isInside({ folder, target })).toBe(false);
  });
});
