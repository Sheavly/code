import { describe, expect, it } from 'vitest';
import { anchorToRoot, showFromRoot } from '../working-root.utils.js';

describe('anchorToRoot', () => {
  it('resolves a relative path against the root', () => {
    expect(anchorToRoot({ requested: 'src/a.ts', root: '/wt' })).toBe('/wt/src/a.ts');
  });

  it('leaves an absolute path alone', () => {
    expect(anchorToRoot({ requested: '/tmp/x', root: '/wt' })).toBe('/tmp/x');
  });

  it('leaves a path alone while no root is set', () => {
    expect(anchorToRoot({ requested: 'src/a.ts', root: undefined })).toBe('src/a.ts');
  });

  it('still honors a leading ../', () => {
    expect(anchorToRoot({ requested: '../other/a.ts', root: '/wt' })).toBe('/other/a.ts');
  });
});

describe('showFromRoot', () => {
  it('shows a path inside the root relative to it', () => {
    expect(showFromRoot({ absolute: '/wt/packages/host/a.ts', root: '/wt' })).toBe(
      'packages/host/a.ts',
    );
  });

  it('shows the root itself as a dot', () => {
    expect(showFromRoot({ absolute: '/wt', root: '/wt' })).toBe('.');
  });

  it('keeps a path outside the root absolute', () => {
    expect(showFromRoot({ absolute: '/tmp/x', root: '/wt' })).toBe('/tmp/x');
  });

  it('keeps every path as it is while no root is set', () => {
    expect(showFromRoot({ absolute: '/wt/a.ts', root: undefined })).toBe('/wt/a.ts');
  });
});
