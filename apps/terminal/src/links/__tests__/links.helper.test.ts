import { stripVTControlCharacters } from 'node:util';
import {
  getCapabilities,
  resetCapabilitiesCache,
  setCapabilities,
  setCapabilityOverrides,
} from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it } from 'vitest';
import { configureHyperlinks, createFileLinker } from '../links.helper.js';

function terminalWithLinks(hyperlinks: boolean): void {
  setCapabilities({ images: null, trueColor: true, hyperlinks });
}

afterEach(() => {
  setCapabilityOverrides({});
  resetCapabilitiesCache();
});

describe('configureHyperlinks', () => {
  it('turns links on or off over what was detected', () => {
    terminalWithLinks(false);
    configureHyperlinks({ SHEAVLY_HYPERLINKS: '1' });
    expect(getCapabilities().hyperlinks).toBe(true);

    configureHyperlinks({ SHEAVLY_HYPERLINKS: '0' });
    expect(getCapabilities().hyperlinks).toBe(false);
  });

  it.each([undefined, '', 'yes'])('keeps the detection for %j', (setting) => {
    terminalWithLinks(true);
    configureHyperlinks({ SHEAVLY_HYPERLINKS: setting });
    expect(getCapabilities().hyperlinks).toBe(true);
  });
});

describe('createFileLinker', () => {
  it('links a path to its file under the root, showing only the path', () => {
    terminalWithLinks(true);

    const linked = createFileLinker({ root: '/work/app', env: {} })('src/a b.ts');

    expect(linked).toBe(
      '\u001b]8;;file:///work/app/src/a%20b.ts\u001b\\src/a b.ts\u001b]8;;\u001b\\',
    );
    expect(stripVTControlCharacters(linked)).toBe('src/a b.ts');
  });

  it('leaves the path as text when the terminal opens no links', () => {
    terminalWithLinks(false);
    expect(createFileLinker({ root: '/work/app', env: {} })('src/a.ts')).toBe('src/a.ts');
  });

  it.each(['SSH_CONNECTION', 'SSH_TTY'])(
    'leaves the path as text over SSH (%s), where the file is not on the terminal’s machine',
    (name) => {
      terminalWithLinks(true);
      expect(createFileLinker({ root: '/work/app', env: { [name]: 'set' } })('src/a.ts')).toBe(
        'src/a.ts',
      );
    },
  );
});
