import { describe, expect, it } from 'vitest';
import {
  MAX_KEEP_ENTRY_CHARS,
  MAX_REQUEST_KEEPS,
} from '@sheavly/extension/approval/approval-keeps.constants';
import { APPROVALS } from '@sheavly/extension/run-services/run-services.utils';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { ApprovalToolNotContributedError, ScopeArgumentError } from '../../errors/scopes.errors.js';
import { approveAll } from '../../testing/approve-all.fake.js';
import { scopeRun } from '../../testing/scope-run.fake.js';

const base = { requires: [APPROVALS.name], contributes: ['run_command'] };
const asTool = { ...base, name: 'as-tool', grants: ['approval:request', 'approval:as-tool'] };
const keeper = { ...base, name: 'keeper', grants: ['approval:request', 'approval:keep'] };
const both = {
  ...base,
  name: 'both',
  grants: ['approval:request', 'approval:as-tool', 'approval:keep'],
};
const request = () => ({
  callId: callIdSchema.parse('c1'),
  command: 'sleep 5 && echo hi',
  concerns: [],
  signal: new AbortController().signal,
});

/** The approvals scope of one activated extension of `run`. */
const scopeOf = (run: ReturnType<typeof scopeRun>, name: string) =>
  run.servicesOf(name).get(APPROVALS);

describe('approval:as-tool', () => {
  it('refuses a tool the manifest declares but the extension does not contribute', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([
      {
        name: 'declares-only',
        requires: [APPROVALS.name],
        grants: ['approval:request', 'approval:as-tool'],
        tools: ['run_command'],
      },
      {
        name: 'also-declares-only',
        requires: [APPROVALS.name],
        grants: ['approval:request', 'approval:as-tool'],
        tools: ['run_command'],
      },
    ]);

    for (const name of ['declares-only', 'also-declares-only']) {
      const forged = scopeOf(run, name).request({ ...request(), tool: 'run_command' });

      await expect(forged).rejects.toThrow(ApprovalToolNotContributedError);
      await expect(forged).rejects.toThrow(new RegExp(`${name}.*run_command`, 's'));
    }

    expect(heard).toEqual([]);
  });

  it('refuses a request made during activate, before the contributions are checked', async () => {
    const run = scopeRun();
    const heard = approveAll(run);
    const refused: unknown[] = [];

    await run.activate([
      {
        ...asTool,
        during: async (services) => {
          await services
            .get(APPROVALS)
            .request({ ...request(), tool: 'run_command' })
            .catch((caughtError: unknown) => void refused.push(caughtError));
        },
      },
    ]);

    expect(refused).toHaveLength(1);
    expect(refused[0]).toBeInstanceOf(ApprovalToolNotContributedError);
    expect(heard).toEqual([]);
    await expect(
      scopeOf(run, 'as-tool').request({ ...request(), tool: 'run_command' }),
    ).resolves.toBeDefined();
  });

  it('refuses again once the extension is stopped', async () => {
    const run = scopeRun();

    const { deactivate } = await run.activate([asTool]);

    await deactivate();

    await expect(
      scopeOf(run, 'as-tool').request({ ...request(), tool: 'run_command' }),
    ).rejects.toThrow();
  });

  it('passes a contributed tool through and leaves the command unprefixed', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([asTool]);
    await scopeOf(run, 'as-tool').request({ ...request(), tool: 'run_command' });

    expect(heard[0]).toMatchObject({ tool: 'run_command', command: 'sleep 5 && echo hi' });
    expect(heard[0]?.options).toEqual(['approve', 'skip', 'skip_with_message']);
  });

  it('refuses a tool the extension does not contribute, naming the extension and the tool', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([asTool]);

    const forged = scopeOf(run, 'as-tool').request({ ...request(), tool: 'start_service' });

    await expect(forged).rejects.toThrow(ApprovalToolNotContributedError);
    await expect(forged).rejects.toThrow(/as-tool.*start_service/s);
    expect(heard).toEqual([]);
  });

  it('matches the declared name exactly, not by prefix or case', async () => {
    const run = scopeRun();

    await run.activate([asTool]);

    const scope = scopeOf(run, 'as-tool');

    await expect(scope.request({ ...request(), tool: 'run_comman' })).rejects.toThrow(
      ApprovalToolNotContributedError,
    );
    await expect(scope.request({ ...request(), tool: 'Run_Command' })).rejects.toThrow(
      ApprovalToolNotContributedError,
    );
  });

  it('without a tool, attributes to the extension even when the grant is held', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([asTool]);
    await scopeOf(run, 'as-tool').request(request());

    expect(heard[0]).toMatchObject({
      tool: 'extension:as-tool',
      command: '[as-tool] sleep 5 && echo hi',
    });
  });
});

describe('approval:keep', () => {
  const keeps = ['sleep *'];
  const options = ['approve', 'allow_session', 'always_allow', 'skip'] as const;

  it('shows the user the options and what they keep', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([keeper]);
    await scopeOf(run, 'keeper').request({ ...request(), options, keeps });

    expect(heard[0]?.options).toEqual(options);
    expect(heard[0]?.keeps).toEqual(keeps);
    expect(heard[0]?.tool).toBe('extension:keeper');
  });

  it('refuses always_allow or allow_session without a non-empty keeps', async () => {
    const run = scopeRun();

    await run.activate([keeper]);

    const scope = run.servicesOf('keeper').get(APPROVALS);

    await expect(scope.request({ ...request(), options })).rejects.toThrow(ScopeArgumentError);
    await expect(scope.request({ ...request(), options, keeps: [] })).rejects.toThrow(
      /must say what it keeps/,
    );
    await expect(
      scope.request({ ...request(), options: ['allow_session'], keeps: [] }),
    ).rejects.toThrow(ScopeArgumentError);
  });

  it('offers a subset of options without keeps when none of them keeps anything', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([keeper]);
    await scopeOf(run, 'keeper').request({ ...request(), options: ['approve', 'skip'] });

    expect(heard[0]?.options).toEqual(['approve', 'skip']);
  });

  it('refuses an unknown or empty options list', async () => {
    const run = scopeRun();

    await run.activate([keeper]);

    const scope = run.servicesOf('keeper').get(APPROVALS);

    const send = (value: unknown) => scope.request({ ...request(), options: value as never });

    await expect(send(['approve', 'sudo'])).rejects.toThrow(ScopeArgumentError);
    await expect(send([])).rejects.toThrow(ScopeArgumentError);
    await expect(send('approve')).rejects.toThrow(ScopeArgumentError);
  });

  it('refuses malformed, too many and too long keeps', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([keeper]);

    const scope = run.servicesOf('keeper').get(APPROVALS);
    const send = (value: unknown) =>
      scope.request({ ...request(), options, keeps: value as never });
    const many = Array.from(
      { length: MAX_REQUEST_KEEPS + 1 },
      (_unused, index) => `cmd${String(index)} *`,
    );
    const long = `exact:["${'x'.repeat(MAX_KEEP_ENTRY_CHARS)}"]`;

    for (const bad of ['git *', [['git', 'log']], ['* rm'], ['git  log'], [7], many, [long]]) {
      await expect(send(bad)).rejects.toThrow(ScopeArgumentError);
    }

    expect(heard).toEqual([]);
  });
});

describe('both grants, as a command tool uses them', () => {
  it('asks as its contributed tool, unprefixed, with options and keeps', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([both]);
    await scopeOf(run, 'both').request({
      ...request(),
      tool: 'run_command',
      options: ['approve', 'allow_session', 'always_allow', 'skip', 'skip_with_message'],
      keeps: ['sleep *'],
    });

    expect(heard[0]).toMatchObject({
      tool: 'run_command',
      command: 'sleep 5 && echo hi',
      keeps: ['sleep *'],
    });
    expect(heard[0]?.options).toContain('always_allow');
  });

  it('still refuses a tool it did not declare', async () => {
    const run = scopeRun();

    await run.activate([both]);

    await expect(
      scopeOf(run, 'both').request({ ...request(), tool: 'bash', keeps: ['sleep *'] }),
    ).rejects.toThrow(ApprovalToolNotContributedError);
  });
});
