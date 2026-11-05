import { describe, expect, it } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import type { ApprovalOption, ApprovalRequest } from '@sheavly/protocol/approval/approval.types';
import { approvalIdSchema } from '@sheavly/protocol/approval/approval.validator';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { ApprovalPrompt } from '../approval-prompt.service.js';
import { approvalText, queueText, statusText } from '../view.utils.js';

const plain = (text: string) => stripVTControlCharacters(text);

const request = (id: string, options?: ApprovalOption[]): ApprovalRequest => ({
  id: approvalIdSchema.parse(id),
  callId: callIdSchema.parse('c1'),
  tool: 'run_command',
  command: 'git push origin main',
  concerns: [
    { argument: 'git push origin main', reason: 'is not allowed yet' },
    { argument: '../other', reason: 'reaches outside the workspace' },
  ],
  options: options ?? ['approve', 'always_allow', 'skip', 'skip_with_message'],
});

describe('approvalText', () => {
  it('is empty when nothing waits', () => {
    expect(approvalText(new ApprovalPrompt())).toBe('');
  });

  it('shows the command, why it is asked, every option numbered, and the keys', () => {
    const prompt = new ApprovalPrompt();

    prompt.ask(request('a1'));
    const text = plain(approvalText(prompt));

    expect(text).toContain('Run git push origin main?');
    expect(text).toContain('git push origin main: is not allowed yet');
    expect(text).toContain('../other: reaches outside the workspace');
    expect(text).toContain('1. Run it once');
    expect(text).toContain('2. Always allow');
    expect(text).toContain('3. Skip');
    expect(text).toContain('4. Skip, and say what to do instead');
    expect(text).toContain('↑↓ or 1-4 to choose · Enter to confirm · Esc to skip');
  });

  it('marks no choice until one is picked, then marks that one', () => {
    const prompt = new ApprovalPrompt();

    prompt.ask(request('a1'));
    expect(plain(approvalText(prompt))).not.toContain('→');

    prompt.move(1);
    prompt.move(1);

    const marked = plain(approvalText(prompt))
      .split('\n')
      .filter((line) => line.includes('→'));

    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('2. Always allow');
  });

  it('lists only the options a request offers, and numbers them 1 to N', () => {
    const prompt = new ApprovalPrompt();

    prompt.ask(request('a1', ['approve', 'skip']));
    const text = plain(approvalText(prompt));

    expect(text).not.toContain('Always allow');
    expect(text).toContain('2. Skip');
    expect(text).toContain('1-2 to choose');
  });

  it('says how many more wait behind the one shown', () => {
    const prompt = new ApprovalPrompt();

    prompt.ask(request('a1'));
    prompt.ask(request('a2'));
    prompt.ask(request('a3'));

    expect(plain(approvalText(prompt))).toContain('+2 more waiting');
  });

  it('asks for the message while one is being typed', () => {
    const prompt = new ApprovalPrompt();

    prompt.ask(request('a1'));
    prompt.pickNumber(4);
    prompt.confirm();
    const text = plain(approvalText(prompt));

    expect(text).toContain('Skip git push origin main');
    expect(text).toContain('Type what it should do instead');
    expect(text).not.toContain('1. Run it once');
  });
});

describe('queueText', () => {
  it('is empty when nothing waits', () => {
    expect(queueText([])).toBe('');
  });

  it('counts the lines waiting and shows each, cutting a long one', () => {
    const long = 'x'.repeat(60);
    const text = plain(queueText(['one', long]));

    expect(text).toContain('2 queued');
    expect(text).toContain('"one"');
    expect(text).toContain(`"${'x'.repeat(39)}…"`);
    expect(text).not.toContain('x'.repeat(41));
  });
});

describe('statusText', () => {
  it.each([
    ['ready', '● ready'],
    ['working', '● working'],
    ['waiting', '● waiting for you'],
  ] as const)('says %s', (state, shown) => {
    expect(plain(statusText({ state, model: 'Fast', mode: 'ask', tasks: 0 }))).toContain(shown);
  });

  it('names the model and the permission mode', () => {
    expect(plain(statusText({ state: 'ready', model: 'Deep', mode: 'always_ask', tasks: 0 }))).toBe(
      '● ready · Deep · mode: always_ask',
    );
  });

  it('counts background tasks only when some run', () => {
    expect(plain(statusText({ state: 'ready', model: 'Fast', mode: 'ask', tasks: 2 }))).toContain(
      '2 running in background',
    );
    expect(
      plain(statusText({ state: 'ready', model: 'Fast', mode: 'ask', tasks: 0 })),
    ).not.toContain('background');
  });

  it('shows allow all in a colour of its own, since it asks about nothing', () => {
    const text = statusText({ state: 'ready', model: 'Fast', mode: 'allow_all', tasks: 0 });

    expect(plain(text)).toContain('mode: allow all');
    expect(text).not.toBe(plain(text));
    expect(text).toContain('\u001b[31m');
  });
});
