import { describe, expect, it } from 'vitest';
import { namesEnvFile, pathArguments, stripPathspecMagic } from '../arguments.utils.js';

describe('pathArguments', () => {
  it('keeps operands, --opt=value values and attached short-option values', () => {
    expect(pathArguments(['-la', '../..', '--stat', '--output=/tmp/x', '-O../x'])).toEqual([
      'a',
      '../..',
      '/tmp/x',
      '../x',
    ]);
  });

  it('reads the file out of an attached -L range', () => {
    expect(pathArguments(['-L1,+5:.env'])).toEqual(['1,+5:.env']);
  });

  it('treats every word after -- as a path, even ones starting with -', () => {
    expect(pathArguments(['-p', '--all', '--', '.env', '-weird'])).toEqual(['.env', '-weird']);
  });
});

describe('stripPathspecMagic', () => {
  it('drops git pathspec magic', () => {
    expect(stripPathspecMagic(':(top).env')).toBe('.env');
    expect(stripPathspecMagic(':/.env')).toBe('.env');
    expect(stripPathspecMagic(':!src')).toBe('src');
    expect(stripPathspecMagic('src/a.ts')).toBe('src/a.ts');
  });
});

describe('namesEnvFile', () => {
  it.each([
    '.env',
    '.ENV.local',
    'config/.env.production',
    'HEAD:.env',
    ':(top).env',
    '1,+5:.env',
    '.\\env', // \ escapes the next character to git: matches .env
    // Git's *, ? and [...] cross /, so every glob can reach a nested .env:
    '*env',
    'c*',
    'config?.env',
    '.en[^x]',
    'con?ig/.e*',
    '*.ts',
  ])('flags %s', (arg) => {
    expect(namesEnvFile(arg)).toBe(true);
  });

  it.each(['src/env.ts', '.envrc', 'HEAD~1', 'environment.md', 'a'])('passes %s', (arg) => {
    expect(namesEnvFile(arg)).toBe(false);
  });
});
