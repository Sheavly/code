import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import { answeringUi } from '@sheavly/runtime/testing/approvals.fake';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { testPermissions } from '../../testing/permissions.fake.js';
import { createRunCommandTool } from '../run-command.tool.js';

const temp = useTempWorkspace({ prefix: 'run-command-permissions-', files: { 'src/a.ts': 'a' } });

const run = (params: {
  command: string;
  permissions: ReturnType<typeof testPermissions>;
  approvals?: ApprovalRegistry;
}) =>
  runTool({
    tools: [
      createRunCommandTool({
        processes: testProcesses(),
        workspace: temp.workspace,
        permissions: params.permissions,
        approvals: params.approvals,
      }),
    ],
    call: {
      id: callIdSchema.parse('1'),
      name: 'run_command',
      input: { description: 'running it', command: params.command },
    },
    signal: new AbortController().signal,
  });

const marker = (name: string) => path.join(temp.root, name);

describe('a command the user has not allowed', () => {
  it('is asked about, with the options that let it be allowed for good', async () => {
    const { asked, approvals } = answeringUi({ decision: 'approve' });
    const result = await run({
      command: `touch ${marker('a')}`,
      permissions: testPermissions(),
      approvals,
    });

    expect(asked).toMatchObject([
      {
        command: `touch ${marker('a')}`,
        concerns: [{ argument: `touch ${marker('a')}`, reason: 'is not allowed yet' }],
        options: ['approve', 'always_allow', 'skip', 'skip_with_message'],
      },
    ]);
    expect(result).toMatchObject({ isError: false });
    expect(existsSync(marker('a'))).toBe(true);
  });

  it('runs once on approve, and is asked about again next time', async () => {
    const permissions = testPermissions();
    const { asked, approvals } = answeringUi({ decision: 'approve' });

    await run({ command: `touch ${marker('b')}`, permissions, approvals });
    await run({ command: `touch ${marker('b')}`, permissions, approvals });

    expect(asked).toHaveLength(2);
    expect(permissions.kept).toEqual([]);
  });

  it('is kept for good on always allow, runs, and is not asked about again', async () => {
    const permissions = testPermissions();
    const { asked, approvals } = answeringUi({ decision: 'always_allow' });
    const first = await run({ command: 'echo hello big world', permissions, approvals });
    const second = await run({ command: 'echo hello small world', permissions, approvals });

    expect(first).toMatchObject({ isError: false });
    expect(second).toMatchObject({ isError: false });
    expect(second.content).toContain('hello small world');
    expect(permissions.kept).toEqual(['echo hello *']);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.keeps).toEqual(permissions.kept);
  });

  it('tells the user what always allow would keep, so the question can say it', async () => {
    const { asked, approvals } = answeringUi({ decision: 'approve' });

    await run({ command: 'echo hello big world', permissions: testPermissions(), approvals });
    await run({
      command: `touch ${marker('w')} && printf x y z`,
      permissions: testPermissions(),
      approvals,
    });
    await run({
      command: `touch '${marker('w x')}'`,
      permissions: testPermissions(),
      approvals,
    });
    await run({
      command: 'echo hi',
      permissions: testPermissions({ mode: 'always_ask' }),
      approvals,
    });

    expect(asked.map(({ keeps }) => keeps)).toEqual([
      ['echo hello *'],
      [`touch ${marker('w')}`, 'printf x *'],
      undefined,
      undefined,
    ]);
  });

  it('keeps only the exact command when it has no arguments to allow beyond its first two words', async () => {
    const permissions = testPermissions();
    const { asked, approvals } = answeringUi({ decision: 'always_allow' });

    await run({ command: `touch ${marker('c')}`, permissions, approvals });
    await run({ command: `touch ${marker('c2')}`, permissions, approvals });

    expect(permissions.kept).toEqual([`touch ${marker('c')}`, `touch ${marker('c2')}`]);
    expect(asked).toHaveLength(2);
    expect(asked.map(({ keeps }) => keeps)).toEqual([
      [`touch ${marker('c')}`],
      [`touch ${marker('c2')}`],
    ]);
  });

  it.each([
    [{ decision: 'skip' } as const, 'Do not retry it without asking the user.'],
    [{ decision: 'skip_with_message', message: 'use ls instead' } as const, 'use ls instead'],
  ])('is not run when the user skips it (%o)', async (response, steer) => {
    const { approvals } = answeringUi(response);
    const result = await run({
      command: `touch ${marker('d')}`,
      permissions: testPermissions(),
      approvals,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain(steer);
    expect(existsSync(marker('d'))).toBe(false);
  });

  it('is refused with no one to ask, naming what is not allowed', async () => {
    const result = await run({
      command: `touch ${marker('e')}`,
      permissions: testPermissions(),
      approvals: new ApprovalRegistry(),
    });

    expect(result.content).toContain("it needs the user's approval");
    expect(result.content).toContain('is not allowed yet');
    expect(existsSync(marker('e'))).toBe(false);
  });

  it('does not offer always allow for a command no entry can spell', async () => {
    const { asked, approvals } = answeringUi({ decision: 'approve' });

    await run({
      command: `touch '${marker('f g')}'`,
      permissions: testPermissions(),
      approvals,
    });

    expect(asked[0]?.options).toEqual(['approve', 'skip', 'skip_with_message']);
  });

  it('cannot be allowed for good by an answer that was not offered', async () => {
    const approvals = new ApprovalRegistry();
    const permissions = testPermissions();

    approvals.subscribe((update) => {
      if (update.type !== 'approval_requested') return;
      expect(() =>
        approvals.respond({ id: update.request.id, response: { decision: 'always_allow' } }),
      ).toThrow('not one of the options offered');
      approvals.respond({ id: update.request.id, response: { decision: 'skip' } });
    });

    await run({
      command: `touch '${marker('h i')}'`,
      permissions,
      approvals,
    });
    expect(permissions.kept).toEqual([]);
  });
});

describe('a line of several commands', () => {
  it('asks once for the line, naming only the commands that are not allowed', async () => {
    const { asked, approvals } = answeringUi({ decision: 'approve' });

    await run({
      command: `ls src | head -n 1 && touch ${marker('j')}`,
      permissions: testPermissions(),
      approvals,
    });

    expect(asked).toHaveLength(1);
    expect(asked[0]?.concerns).toEqual([
      { argument: `touch ${marker('j')}`, reason: 'is not allowed yet' },
    ]);
  });

  it('runs none of it when the user skips, not even the commands that were allowed', async () => {
    const { approvals } = answeringUi({ decision: 'skip' });
    const result = await run({
      command: `touch ${marker('k')} && touch ${marker('l')}`,
      permissions: testPermissions({ allow: ['touch *'] }),
      approvals,
    });

    expect(result).toMatchObject({ isError: false });
    expect(existsSync(marker('k'))).toBe(true);
    expect(existsSync(marker('l'))).toBe(true);

    const skipped = await run({
      command: `touch ${marker('m')} && rm ${marker('k')}`,
      permissions: testPermissions({ allow: ['touch *'] }),
      approvals,
    });

    expect(skipped).toMatchObject({ isError: true });
    expect(existsSync(marker('m'))).toBe(false);
    expect(existsSync(marker('k'))).toBe(true);
  });

  it('keeps one entry for each kind of command not allowed on always allow, once each', async () => {
    const permissions = testPermissions();
    const { asked, approvals } = answeringUi({ decision: 'always_allow' });

    await run({
      command: 'echo a b && printf x y z ; echo a c',
      permissions,
      approvals,
    });

    expect(permissions.kept).toEqual(['echo a *', 'printf x *']);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.keeps).toEqual(permissions.kept);
  });

  it('does not offer always allow when only an argument is risky, and the command is allowed', async () => {
    const { asked, approvals } = answeringUi({ decision: 'approve' });

    await run({ command: 'ls ..', permissions: testPermissions(), approvals });

    expect(asked[0]?.options).toEqual(['approve', 'skip', 'skip_with_message']);
    expect(asked[0]?.concerns).toEqual([
      { argument: '..', reason: 'reaches outside the workspace' },
    ]);
    expect(asked[0]).not.toHaveProperty('keeps');
  });
});

describe('the modes', () => {
  it('always_ask asks about a built-in command, and offers no always allow', async () => {
    const { asked, approvals } = answeringUi({ decision: 'approve' });

    await run({ command: 'pwd', permissions: testPermissions({ mode: 'always_ask' }), approvals });

    expect(asked).toMatchObject([
      {
        concerns: [{ argument: 'pwd', reason: 'is asked about every time in this folder' }],
        options: ['approve', 'skip', 'skip_with_message'],
      },
    ]);
  });

  it('always_ask ignores the user’s allow list', async () => {
    const { asked, approvals } = answeringUi({ decision: 'skip' });
    const result = await run({
      command: `touch ${marker('q')}`,
      permissions: testPermissions({ mode: 'always_ask', allow: ['touch *'] }),
      approvals,
    });

    expect(asked).toHaveLength(1);
    expect(result).toMatchObject({ isError: true });
    expect(existsSync(marker('q'))).toBe(false);
  });

  it('allow_all runs anything, asking about nothing, risky arguments included', async () => {
    const { asked, approvals } = answeringUi({ decision: 'skip' });
    const result = await run({
      command: `ls .. && touch ${marker('r')}`,
      permissions: testPermissions({ mode: 'allow_all' }),
      approvals,
    });

    expect(result).toMatchObject({ isError: false });
    expect(asked).toEqual([]);
    expect(existsSync(marker('r'))).toBe(true);
  });

  it('allow_all still refuses what cannot be run without a shell', async () => {
    const result = await run({
      command: `echo x > ${marker('s')}`,
      permissions: testPermissions({ mode: 'allow_all' }),
    });

    expect(result).toMatchObject({ isError: true });
    expect(existsSync(marker('s'))).toBe(false);
  });

  it('a mode changed between commands applies to the next one', async () => {
    const permissions = testPermissions();
    const { asked, approvals } = answeringUi({ decision: 'skip' });

    await run({ command: `touch ${marker('t')}`, permissions, approvals });
    permissions.setMode('allow_all');
    await run({ command: `touch ${marker('u')}`, permissions, approvals });

    expect(asked).toHaveLength(1);
    expect(existsSync(marker('t'))).toBe(false);
    expect(existsSync(marker('u'))).toBe(true);
  });
});

describe('when the entry cannot be kept', () => {
  it('does not run the line, and says why', async () => {
    const permissions = testPermissions();
    const { approvals } = answeringUi({ decision: 'always_allow' });

    permissions.allow = () => Promise.reject(new Error('disk full'));

    const result = await run({ command: `touch ${marker('v')}`, permissions, approvals });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('disk full');
    expect(existsSync(marker('v'))).toBe(false);
  });
});
