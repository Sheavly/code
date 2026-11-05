import { describe, expect, it } from 'vitest';
import {
  isBareName,
  isSearcher,
  programName,
  runsOtherPrograms,
  searchesFiles,
} from '../program.utils.js';

describe('programName', () => {
  it.each([
    ['find', 'find'],
    ['/usr/bin/find', 'find'],
    ['./find', 'find'],
    ['C:\\tools\\Find.EXE', 'find'],
    ['FIND', 'find'],
  ])('reads %s as %s', (word, name) => {
    expect(programName(word)).toBe(name);
  });
});

describe('runsOtherPrograms', () => {
  it.each([
    [['find', 'src']],
    [['/usr/bin/find', 'src']],
    [['xargs', 'rm']],
    [['npx', 'turbo']],
    [['sed', '-i', 's/a/b/', 'x']],
    [['python']],
    [['python3']],
    [['python3.12', 'x.py']],
    [['npm', 'exec', 'tool']],
    [['npm', 'x', 'tool']],
    [['ssh', 'host']],
  ])('is true for %j', (argv) => {
    expect(runsOtherPrograms(argv)).toBe(true);
  });

  it.each([
    [['git', 'log']],
    [['grep', 'x']],
    [['npm', 'run', 'test']],
    [['npm', 'install']],
    [['ls']],
    [['pythonista']],
    [['findutils']],
    [[]],
  ])('is false for %j', (argv) => {
    expect(runsOtherPrograms(argv)).toBe(false);
  });
});

describe('isSearcher', () => {
  it.each([[['grep']], [['egrep', 'x']], [['fgrep', 'x']], [['GREP', 'x']]])(
    'is true for the bare name in %j',
    (argv) => {
      expect(isSearcher(argv)).toBe(true);
    },
  );

  it.each([
    [['./grep', 'x']],
    [['/usr/bin/grep', 'x']],
    [['rg', 'x']],
    [['ag', 'x']],
    [['ack', 'x']],
    [['git', 'grep', 'x']],
    [['zgrep', 'x']],
  ])('is false for %j', (argv) => {
    expect(isSearcher(argv)).toBe(false);
  });
});

describe('searchesFiles', () => {
  it('knows a searcher by its name wherever it lives, so a path cannot dodge the .env guard', () => {
    expect(searchesFiles('grep')).toBe(true);
    expect(searchesFiles('/usr/bin/grep')).toBe(true);
    expect(searchesFiles('./GREP')).toBe(true);
    expect(searchesFiles('git')).toBe(false);
  });
});

describe('isBareName', () => {
  it('tells a name from a path', () => {
    expect(isBareName('grep')).toBe(true);
    expect(isBareName('./grep')).toBe(false);
    expect(isBareName('bin/grep')).toBe(false);
    expect(isBareName('C:\\grep')).toBe(false);
  });
});
