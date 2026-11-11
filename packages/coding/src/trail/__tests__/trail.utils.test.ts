import { describe, expect, it } from 'vitest';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { fileTrail } from '../trail.utils.js';

const call = (name: string, input: unknown) => ({
  id: callIdSchema.parse('c1'),
  name,
  input,
});

describe('fileTrail', () => {
  it('says what was written, edited and read, from the call’s own arguments', () => {
    expect(fileTrail(call('write_file', { path: 'src/a.ts', content: 'x' }))).toBe(
      'wrote src/a.ts',
    );
    expect(fileTrail(call('edit_file', { path: 'src/a.ts', oldText: 'a', newText: 'b' }))).toBe(
      'edited src/a.ts',
    );
    expect(fileTrail(call('delete_file', { path: 'src/a.ts' }))).toBe('deleted src/a.ts');
    expect(fileTrail(call('read_file', { path: 'src/a.ts' }))).toBe('read src/a.ts');
  });

  it('says which lines of a file were read', () => {
    expect(fileTrail(call('read_file', { path: 'a.ts', startLine: 10, endLine: 40 }))).toBe(
      'read a.ts lines 10–40',
    );
    expect(fileTrail(call('read_file', { path: 'a.ts', startLine: 10 }))).toBe(
      'read a.ts lines 10–end',
    );
  });

  it('says what command ran, on one line and cut when long', () => {
    expect(fileTrail(call('run_command', { command: 'npm test' }))).toBe('ran: npm test');

    const long = fileTrail(call('run_command', { command: `echo ${'x'.repeat(300)}\nrm -rf` }));

    expect(long?.length).toBeLessThan(135);
    expect(long).not.toContain('\n');
    expect(long?.endsWith('…')).toBe(true);
  });

  it('redacts a credential typed into a command, since the trail is stored and re-sent', () => {
    const line = fileTrail(
      call('run_command', {
        command: 'curl -H "Authorization: Bearer abcdef123456789" https://x.test API_KEY=hunter2',
      }),
    );

    expect(line).not.toContain('abcdef123456789');
    expect(line).not.toContain('hunter2');
    expect(line).toContain('[REDACTED]');
  });

  it('does not wrap a command in backticks a command of its own could close', () => {
    expect(fileTrail(call('run_command', { command: 'echo `date`' }))).toBe('ran: echo `date`');
  });

  it('cuts on code points, never leaving half of an emoji', () => {
    const line = fileTrail(call('write_file', { path: '😀'.repeat(300), content: '' }));

    expect(line?.endsWith('…')).toBe(true);
    // A lone surrogate would not survive a round trip through well-formed UTF-8.
    expect(line?.isWellFormed()).toBe(true);
  });

  it('skips a path or command that is only whitespace', () => {
    expect(fileTrail(call('write_file', { path: '  \n', content: '' }))).toBeUndefined();
    expect(fileTrail(call('read_file', { path: ' ' }))).toBeUndefined();
    expect(fileTrail(call('run_command', { command: '   ' }))).toBeUndefined();
  });

  it('keeps a model-written path from growing the trail without bound', () => {
    const line = fileTrail(call('write_file', { path: 'a/'.repeat(500), content: '' }));

    expect(line?.length).toBeLessThanOrEqual(206);
    expect(line?.endsWith('…')).toBe(true);
  });

  it('says nothing for another tool, or for input that does not fit the tool', () => {
    expect(fileTrail(call('web_fetch', { url: 'https://example.test' }))).toBeUndefined();
    expect(fileTrail(call('write_file', { content: 'no path' }))).toBeUndefined();
    expect(fileTrail(call('read_file', { path: 5 }))).toBeUndefined();
    expect(fileTrail(call('run_command', null))).toBeUndefined();
  });
});
