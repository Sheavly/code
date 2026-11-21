import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sheavlyHome } from '../home.helper.js';

describe('sheavlyHome', () => {
  it('is .sheavly in the user’s home, unless SHEAVLY_HOME says otherwise', () => {
    expect(sheavlyHome({})).toBe(path.join(os.homedir(), '.sheavly'));
    expect(sheavlyHome({ SHEAVLY_HOME: '/elsewhere/sheavly' })).toBe('/elsewhere/sheavly');
  });

  it('counts an empty SHEAVLY_HOME as not set', () => {
    expect(sheavlyHome({ SHEAVLY_HOME: '' })).toBe(path.join(os.homedir(), '.sheavly'));
  });
});
