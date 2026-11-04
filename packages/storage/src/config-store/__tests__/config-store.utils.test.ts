import { describe, expect, it } from 'vitest';
import { workspaceKey } from '../config-store.utils.js';

describe('workspaceKey', () => {
  it('is the SHA-256 of the real path, as the system’s own tool computes it', () => {
    // Pinned from `printf … | sha256sum`: a change would orphan every stored conversation.
    expect(
      workspaceKey({ realPath: '/home/gustaf/projects/coding-harness', platform: 'posix' }),
    ).toBe('397725f3a7fe4c9b294afa6ce9f849197ab33ef94f8f58171cd248858d178e82');
    expect(workspaceKey({ realPath: 'c:\\users\\x\\proj', platform: 'win32' })).toBe(
      'bcff364231b8a30bee96eb77df029a5479862cc530260fa6e1b60181a1c8b7d5',
    );
  });

  it('is 64 lowercase hex characters: a name any system can give a folder, in any case', () => {
    for (const platform of ['posix', 'win32'] as const) {
      expect(workspaceKey({ realPath: '/some/where', platform })).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('calls one Windows folder one key, however it is spelled', () => {
    const spellings = [
      'C:\\Users\\X\\Proj',
      'c:\\users\\x\\proj',
      'C:\\Users\\X\\Proj\\',
      'C:/Users/X/Proj',
      'C:\\Users\\X\\.\\Proj',
      'C:\\Users\\X\\Other\\..\\Proj',
    ];
    const keys = new Set(
      spellings.map((realPath) => workspaceKey({ realPath, platform: 'win32' })),
    );

    expect(keys.size).toBe(1);
  });

  it('keeps Windows folders that differ apart, and its drives', () => {
    const key = (realPath: string) => workspaceKey({ realPath, platform: 'win32' });

    expect(key('C:\\Users\\X\\Proj')).not.toBe(key('C:\\Users\\X\\Proj2'));
    expect(key('C:\\Proj')).not.toBe(key('D:\\Proj'));
    expect(key('C:\\')).not.toBe(key('D:\\'));
  });

  it('keeps case on other systems: /Work/Proj and /work/proj are two folders there', () => {
    const key = (realPath: string) => workspaceKey({ realPath, platform: 'posix' });

    expect(key('/Work/Proj')).not.toBe(key('/work/proj'));
  });

  it('drops a trailing separator on other systems, and keeps the root as it is', () => {
    const key = (realPath: string) => workspaceKey({ realPath, platform: 'posix' });

    expect(key('/work/proj/')).toBe(key('/work/proj'));
    expect(key('/work//proj')).toBe(key('/work/proj'));
    expect(key('/')).not.toBe(key('/work'));
    expect(key('/')).toBe(key('//'));
  });

  it('is a different key on Windows and elsewhere for the same text only where the system differs', () => {
    // A path that is the same text on both: the platform decides case, so a lowercase path agrees.
    expect(workspaceKey({ realPath: '/work/proj', platform: 'win32' })).toBe(
      workspaceKey({ realPath: '\\work\\proj', platform: 'win32' }),
    );
  });
});
