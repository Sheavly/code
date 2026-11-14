import { describe, expect, it } from 'vitest';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { commandOf, firstLine, ownLine, projectTrustNotice } from '../render.utils.js';

describe('commandOf', () => {
  const call = (name: string, input: unknown) => ({ id: callIdSchema.parse('c1'), name, input });

  it.each(['run_command', 'start_service'])('shows the command of a %s call', (name) => {
    expect(commandOf(call(name, { command: 'npm run dev' }))).toBe('npm run dev');
  });

  it.each(['run_command', 'start_service'])(
    'neutralises control characters in a %s call',
    (name) => {
      const shown = commandOf(call(name, { command: 'echo hi\u001b]52;c;x\u0007' }));

      expect(shown).not.toContain('\u001b');
      expect(shown).not.toContain('\u0007');
    },
  );

  it('shows nothing for another tool, or an input with no command', () => {
    expect(commandOf(call('read_file', { command: 'x' }))).toBeUndefined();
    expect(commandOf(call('start_service', {}))).toBeUndefined();
  });
});

describe('firstLine', () => {
  it('drops escape codes, so a cut never leaves a style on for what follows', () => {
    const dim = `\u001B[2m${'x'.repeat(120)}\u001B[22m`;

    expect(firstLine(`\n${dim}\nnext`)).toBe(`${'x'.repeat(100)}…`);
  });

  it('skips a line that is only escape codes', () => {
    expect(firstLine('\u001B[2m\u001B[22m\nkept')).toBe('kept');
  });
});

describe('ownLine', () => {
  it('is the first line uncut, with a count of the lines left out', () => {
    const long = `Edited ${'deep/'.repeat(40)}a.ts (1 → 2 lines)`;

    expect(ownLine(`${long}\n\nreport\nmore`)).toBe(`${long} · +2 lines for the model`);
  });

  it('adds nothing when the result is one line, and skips blank and escape-only lines', () => {
    expect(ownLine('Created a.ts (0 → 1 lines)')).toBe('Created a.ts (0 → 1 lines)');
    expect(ownLine('\n\u001B[2m\u001B[22m\nkept')).toBe('kept');
  });

  it('is empty for an empty result, instead of throwing', () => {
    expect(ownLine('')).toBe('');
  });
});

describe('projectTrustNotice', () => {
  it('says why .sheavly/ hooks were skipped, and how to trust them', () => {
    expect(projectTrustNotice('untrusted')).toMatch(/not trusted.*--trust/);
    expect(projectTrustNotice('changed')).toMatch(/changed since you trusted.*--trust/);
  });

  it('says nothing when the hooks ran or there were none', () => {
    expect(projectTrustNotice('trusted')).toBeUndefined();
    expect(projectTrustNotice('no_hooks')).toBeUndefined();
  });
});
