import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isFilesystemRoot, unsafeFileRemovalReason, unsafeRemovalReason } from '../folder.utils.js';

const TMP = path.resolve(path.sep, 'data');
const ROOT = path.join(TMP, 'profiles');
const ID = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';
const OTHER = '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71';
const HOME = path.join(TMP, 'home', 'someone');

const reason = (folder: string, overrides: { root?: string; home?: string } = {}) =>
  unsafeRemovalReason({ root: ROOT, home: HOME, folder, ...overrides });

describe('unsafeRemovalReason: the folders a store may delete', () => {
  it.each([
    ['an id-named folder directly inside the store’s', path.join(ROOT, ID)],
    ['the same with a trailing separator', `${path.join(ROOT, ID)}${path.sep}`],
    ['the same reached through a `..` that lands there', path.join(ROOT, OTHER, '..', ID)],
  ])('allows %s', (_label, folder) => {
    expect(reason(folder)).toBeUndefined();
  });

  it.each([
    ['an empty path', ''],
    ['a relative path', path.join('profiles', ID)],
    ['just an id, taken from wherever the process runs', ID],
    ['the store’s own folder', ROOT],
    ['the folder above the store', TMP],
    ['a file system’s top', path.parse(TMP).root],
    ['a folder that is not named by an id', path.join(ROOT, 'work')],
    [
      'a folder named for an id in capitals (two names on macOS and Windows)',
      path.join(ROOT, ID.toUpperCase()),
    ],
    ['a folder named like an id with something added', path.join(ROOT, `${ID}-old`)],
    ['an id-named folder one level too deep', path.join(ROOT, OTHER, ID)],
    ['an id-named folder outside the store', path.join(TMP, 'elsewhere', ID)],
    ['a `..` that climbs out of the store', path.join(ROOT, ID, '..', '..')],
    ['an id-named folder beside the store', path.join(ROOT, '..', ID)],
  ])('refuses %s', (_label, folder) => {
    expect(reason(folder)).toEqual(expect.any(String));
  });

  it('refuses when the store’s own folder is a file system’s top', () => {
    const top = path.parse(TMP).root;

    expect(reason(path.join(top, ID), { root: top })).toMatch(/root of a file system/);
  });

  it('refuses a relative store folder, even with an id-named folder in it', () => {
    expect(reason(path.join(ROOT, ID), { root: 'profiles' })).toMatch(/not absolute/);
  });

  it('refuses the home folder, and any folder that holds it', () => {
    const home = path.join(ROOT, ID);

    expect(reason(home, { home })).toMatch(/home folder/);
    expect(reason(home, { home: path.join(home, 'sub') })).toMatch(/home folder/);
    // A name that only starts with two dots is a folder in it, not a way out of it.
    expect(reason(home, { home: path.join(home, '..hidden') })).toMatch(/home folder/);
  });

  it('allows a folder that is only beside the home folder', () => {
    expect(reason(path.join(ROOT, ID), { home: path.join(ROOT, OTHER) })).toBeUndefined();
  });
});

describe('isFilesystemRoot', () => {
  it('is true for the top of a file system and false for anything in it', () => {
    expect(isFilesystemRoot(path.parse(TMP).root)).toBe(true);
    expect(isFilesystemRoot(TMP)).toBe(false);
  });
});

describe('unsafeFileRemovalReason: the files a store may delete', () => {
  const file = (overrides: { folder?: string; id?: string; extension?: string }) =>
    unsafeFileRemovalReason({ folder: ROOT, id: ID, extension: '.json', ...overrides });

  it.each([
    ['an id with .json', {}],
    ['an id with .jsonl', { extension: '.jsonl' }],
  ])('allows %s', (_label, overrides) => {
    expect(file(overrides)).toBeUndefined();
  });

  it.each([
    ['an empty id', { id: '' }],
    ['a name that is not an id', { id: 'work' }],
    ['an id in capitals', { id: ID.toUpperCase() }],
    ['an id with a path in front', { id: `../${ID}` }],
    ['an id with a path behind', { id: `${ID}/../..` }],
    ['an id with a separator in it', { id: `${ID}${path.sep}x` }],
    ['a parent folder as the id', { id: '..' }],
    ['a glob', { id: '*' }],
    ['an empty extension', { extension: '' }],
    ['an extension that is a path', { extension: '/../x' }],
    ['an extension with no dot', { extension: 'json' }],
    ['an extension with two dots', { extension: '..json' }],
    ['an extension that is long', { extension: '.abcdefghijk' }],
    ['a relative folder', { folder: 'models' }],
    ['a file system’s top as the folder', { folder: path.parse(TMP).root }],
  ])('refuses %s', (_label, overrides) => {
    expect(file(overrides)).toEqual(expect.any(String));
  });
});
