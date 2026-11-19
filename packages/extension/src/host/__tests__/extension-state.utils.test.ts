import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExtensionStateError } from '../../errors/extension.errors.js';
import { EXTENSION_STATES } from '../extension-state.constants.js';
import type { ExtensionState } from '../extension-state.types.js';
import { canMove, extensionLifecycleMarkdown, isFinalState } from '../extension-state.utils.js';
import { ExtensionStates } from '../extension-states.service.js';

const ALLOWED: readonly (readonly [ExtensionState, ExtensionState])[] = [
  ['sealed', 'activating'],
  ['activating', 'verified'],
  ['activating', 'skipped'],
  ['activating', 'failed'],
  ['activating', 'stopped'],
  ['verified', 'merged'],
  ['verified', 'rolled-back'],
  ['verified', 'stopped'],
  ['merged', 'stopped'],
];

/** The two documents that print the table: this package's lifecycle note and the repository's guide. */
const GUIDES = [
  join(import.meta.dirname, '../../../docs/lifecycle.md'),
  join(import.meta.dirname, '../../../../..', '.agents/skills/sheavly/state-machines.md'),
];

/** The table with runs of spaces and dashes collapsed, so Prettier's column padding does not matter. */
function collapsed(table: string): string {
  return table.replaceAll(/[\s-]+/g, ' ').trim();
}

/** Walks a fresh extension along `path`, which must start at `sealed`. */
function walk(path: readonly Exclude<ExtensionState, 'sealed' | 'verified'>[]) {
  const states = new ExtensionStates(['one']);

  for (const to of path) {
    if (to === 'merged') states.verify({ extension: 'one', tools: ['one.a'] });
    states.move({ extension: 'one', to });
  }

  return states;
}

describe('the extension state table', () => {
  it.each(ALLOWED)('allows %s to move to %s', (from, to) => {
    expect(canMove({ from, to })).toBe(true);
  });

  it('refuses every move the table does not list, a move to itself and any move out of a final state included', () => {
    const pairs = EXTENSION_STATES.flatMap((from) =>
      EXTENSION_STATES.map((to) => [from, to] as const),
    );
    const listed = new Set(ALLOWED.map(([from, to]) => `${from}>${to}`));

    for (const [from, to] of pairs.filter(([a, b]) => !listed.has(`${a}>${b}`))) {
      expect(canMove({ from, to }), `${from} to ${to}`).toBe(false);
    }
  });

  it('names the shortcuts that must stay refused', () => {
    expect(canMove({ from: 'sealed', to: 'merged' })).toBe(false);
    expect(canMove({ from: 'activating', to: 'merged' })).toBe(false);
    expect(canMove({ from: 'merged', to: 'verified' })).toBe(false);
    expect(canMove({ from: 'merged', to: 'rolled-back' })).toBe(false);
    expect(canMove({ from: 'failed', to: 'activating' })).toBe(false);
  });

  it('has exactly skipped, failed, rolled-back and stopped as final states', () => {
    expect(EXTENSION_STATES.filter((state) => isFinalState(state))).toEqual([
      'skipped',
      'failed',
      'rolled-back',
      'stopped',
    ]);
  });
});

describe('ExtensionStates', () => {
  it('starts every extension sealed with no contributed tools', () => {
    const states = new ExtensionStates(['one']);

    expect(states.stateOf('one')).toBe('sealed');
    expect(states.contributedTools('one')).toEqual([]);
  });

  it('holds the tool names only while merged', () => {
    const states = new ExtensionStates(['one']);

    states.move({ extension: 'one', to: 'activating' });
    states.verify({ extension: 'one', tools: ['one.a'] });

    expect(states.contributedTools('one')).toEqual([]);

    states.move({ extension: 'one', to: 'merged' });

    expect(states.contributedTools('one')).toEqual(['one.a']);

    states.move({ extension: 'one', to: 'stopped' });

    expect(states.contributedTools('one')).toEqual([]);
  });

  it('throws an ExtensionStateError for a move the table refuses, and keeps the state', () => {
    const states = walk(['activating', 'failed']);

    expect(() => states.move({ extension: 'one', to: 'activating' })).toThrow(ExtensionStateError);
    expect(() => states.verify({ extension: 'one', tools: [] })).toThrow(ExtensionStateError);
    expect(states.stateOf('one')).toBe('failed');
  });

  it('refuses to merge an extension that was not verified', () => {
    const states = walk(['activating']);

    expect(() => states.move({ extension: 'one', to: 'merged' })).toThrow(ExtensionStateError);
    expect(states.stateOf('one')).toBe('activating');
  });
});

describe.each(GUIDES)('the lifecycle table in %s', (path) => {
  it('is the state table as it is (rewrite the block between the markers from extensionLifecycleMarkdown)', async () => {
    const guide = await readFile(path, 'utf8');
    const [, rest = ''] = guide.split('<!-- extension-lifecycle:start -->');
    const [printed = ''] = rest.split('<!-- extension-lifecycle:end -->');

    expect(collapsed(printed)).toBe(collapsed(extensionLifecycleMarkdown()));
  });
});
