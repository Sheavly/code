import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isFilesystemRoot,
  unsafeNameReason,
  unsafeRemovalReason,
  unsafeRootReason,
} from '../safe-path.utils.js';

const TMP = path.resolve(path.sep, 'data');
const ROOT = path.join(TMP, 'profiles');
const TOP = path.parse(TMP).root;
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
    ['a file system’s top', TOP],
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
    expect(reason(path.join(TOP, ID), { root: TOP })).toMatch(/root of a file system/);
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

describe('unsafeRootReason: where a store may keep things', () => {
  it('allows an absolute folder', () => {
    expect(unsafeRootReason(ROOT)).toBeUndefined();
    expect(unsafeRootReason(path.join(ROOT, 'a', '..', 'b'))).toBeUndefined();
  });

  it.each([
    ['empty', ''],
    ['relative', 'profiles'],
    ['relative with a dot', path.join('.', 'profiles')],
    ['a parent folder', '..'],
    ['the top of a file system', TOP],
    ['the top of a file system reached through `..`', path.join(ROOT, '..', '..')],
  ])('refuses a folder that is %s', (_label, root) => {
    expect(unsafeRootReason(root)).toEqual(expect.any(String));
  });
});

describe('unsafeNameReason: what a store may call a file or folder', () => {
  it.each([
    ['an id', {}],
    ['an id with .json', { extension: '.json' }],
    ['an id with .jsonl', { extension: '.jsonl' }],
  ])('allows %s', (_label, overrides) => {
    expect(unsafeNameReason({ id: ID, ...overrides })).toBeUndefined();
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
    ['an extension that is a path', { id: ID, extension: '/../x' }],
    ['an extension with no dot', { id: ID, extension: 'json' }],
    ['an extension with two dots', { id: ID, extension: '..json' }],
    ['an extension that is long', { id: ID, extension: '.abcdefghijk' }],
    ['an extension in capitals', { id: ID, extension: '.JSON' }],
  ])('refuses %s', (_label, params) => {
    expect(unsafeNameReason(params)).toEqual(expect.any(String));
  });
});

describe('isFilesystemRoot', () => {
  it('is true for the top of a file system and false for anything in it', () => {
    expect(isFilesystemRoot(TOP)).toBe(true);
    expect(isFilesystemRoot(TMP)).toBe(false);
  });
});
