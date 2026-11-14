import { describe, expect, it } from 'vitest';
import { approvalRequestSchema } from '@sheavly/protocol/approval/approval.validator';
import { parseCommand as parseRunCommand } from '@sheavly/coding/run-command/allow-list.utils';
import { checkApprovalResponse, stepApprovedCommands } from '../check-approval.utils.js';
import { judgeRun } from '../check.utils.js';
import { parseCommand } from '../workbook.utils.js';
import { parsePromptFile } from '../workbook.validator.js';

function response(overrides: Record<string, unknown> = {}, approvedCommands = ['node']) {
  const command = typeof overrides.command === 'string' ? overrides.command : 'node check.mjs';
  const parsed = parseRunCommand(command);
  const concerns = parsed.ok
    ? parsed.steps.map(({ argv }) => ({ argument: argv.join(' '), reason: 'is not allowed yet' }))
    : [];
  const raw = {
    id: 'approval',
    callId: 'call',
    tool: 'run_command',
    command,
    concerns,
    keeps: ['node *'],
    options: ['approve', 'allow_session', 'always_allow', 'skip'],
    ...overrides,
  };
  const request = approvalRequestSchema.parse(
    Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)),
  );

  return checkApprovalResponse({ request, approvedCommands });
}

describe('explicit check CLI authorization', () => {
  it('defaults to no authorization and supports repeated bases without eating a prompt name', () => {
    expect(parseCommand(['check', 'node'])).toEqual({
      name: 'check',
      prompts: ['node'],
      all: false,
      approvedCommands: [],
    });
    expect(
      parseCommand([
        'check',
        'node',
        '--approve-command',
        'node',
        '--all',
        '--approve-command',
        'npm run test',
      ]),
    ).toEqual({
      name: 'check',
      prompts: ['node'],
      all: true,
      approvedCommands: ['node', 'npm run test'],
    });
  });

  it.each([
    'node check.mjs',
    '/bin/node',
    'node *',
    'exact:node',
    'node && curl',
    'env node',
    '',
    'npm --prefix /outside',
  ])('rejects non-base input %j', (base) => {
    expect(() => parseCommand(['check', '--approve-command', base])).toThrow(/approve-command/);
  });

  it.each([
    ['check', '--approve-command'],
    ['check', '--approve-command', '--all'],
    ['check', '--approve-command=node'],
    ['run', 'a', '--approve-command', 'node'],
    ['check', '--trust'],
    ['check', '--allow-all'],
  ])('rejects invalid/check-only flags %j', (...argv) => {
    expect(() => parseCommand(argv)).toThrow();
  });

  it('never authorizes from stored front matter', () => {
    const prompt = parsePromptFile({
      name: 'fixture',
      source:
        '---\napprovedCommands: ["node"]\napprovalScope: conversation-session\n---\nRun the check.',
    });

    expect(prompt).toEqual({ name: 'fixture', text: 'Run the check.' });
    expect(response({}, [])).toEqual({ decision: 'skip' });
  });
});

describe('structured check approvals', () => {
  it('denies Node in a no-command step and still fails the recorded request', () => {
    const step = { forbid: { tools: ['run_command'] } };
    const approvedCommands = stepApprovedCommands({ step, approvedCommands: ['node'] });

    expect(response({}, [...approvedCommands])).toEqual({ decision: 'skip' });
    expect(stepApprovedCommands({ step: {}, approvedCommands: ['node'] })).toEqual(['node']);
    expect(
      judgeRun({
        expectation: step,
        observed: {
          transcript: '',
          reply: '',
          tools: ['run_command'],
          toolResults: {},
          toolErrors: { run_command: 'The user skipped this command: node check.mjs' },
          events: ['tool_call_started', 'tool_result'],
          contextHooks: [],
          outcome: 'completed',
          adapter: 'fake',
        },
      }),
    ).toEqual(['run_command in tools']);
  });

  it.each(['run_command', 'start_service'])(
    'treats %s as a command request, for approval and for a forbid',
    (tool) => {
      expect(response({ tool })).toEqual({ decision: 'allow_session' });
      expect(
        stepApprovedCommands({ step: { forbid: { tools: [tool] } }, approvedCommands: ['node'] }),
      ).toEqual([]);
    },
  );

  it('skips a request from a tool that is not a command tool', () => {
    expect(response({ tool: 'write_file' })).toEqual({ decision: 'skip' });
  });

  it('prefers an offered temporary session grant and covers all node arguments', () => {
    expect(response()).toEqual({ decision: 'allow_session' });
    expect(response({ command: "node -e \"require('child_process').spawnSync('curl')\"" })).toEqual(
      { decision: 'allow_session' },
    );
    expect(response({ command: 'node a | node b && node c || node d; node e' })).toEqual({
      decision: 'allow_session',
    });
  });

  it.each([
    'node a && curl x',
    'node a | find .',
    'node a; curl x',
    'env node a',
    'sh -c "node a"',
    'npx node a',
    'node a > output',
    'node $(curl x)',
  ])('denies every unauthorized or unparseable chain %s', (command) => {
    expect(response({ command })).toEqual({ decision: 'skip' });
  });

  it.each([
    { tool: 'read_file' },
    { keeps: ['node *', 'curl *'] },
    { concerns: [{ argument: 'run in /outside', reason: 'is outside the workspace root' }] },
    {
      concerns: [
        {
          argument: 'git worktree add ../other',
          reason: 'makes that folder readable and writable by the file tools for this session',
        },
      ],
    },
    { concerns: [{ argument: 'node a', reason: 'unknown safety concern' }] },
    { concerns: [{ argument: 'find .', reason: 'is not allowed yet' }] },
    { concerns: [] },
  ])('rejects broad keeps, other tools and ungrantable concerns %j', (overrides) => {
    expect(response(overrides)).toEqual({ decision: 'skip' });
  });

  it('approves once only when offered, retaining always-ask behavior', () => {
    expect(
      response({
        command: 'node a',
        keeps: undefined,
        options: ['approve', 'skip'],
        concerns: [{ argument: 'node a', reason: 'is asked about every time in this folder' }],
      }),
    ).toEqual({ decision: 'approve' });
    expect(response({ options: ['always_allow', 'skip'] })).toEqual({ decision: 'skip' });
    expect(response({ keeps: [], options: ['allow_session', 'skip'] })).toEqual({
      decision: 'skip',
    });
  });
});
