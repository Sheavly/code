import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { testPermissions } from '../../testing/permissions.fake.js';
import { createRunCommandTool } from '../run-command.tool.js';

const temp = useTempWorkspace({
  prefix: 'grep-env-',
  files: {
    'src/a.ts': 'const x = SECRET_NAME;',
    '.env': 'SECRET_NAME=hunter2',
    '.env.local': 'SECRET_NAME=hunter3',
    'config/.env.production': 'SECRET_NAME=hunter4',
  },
});

const run = (command: string, permissions = testPermissions({ allow: ['grep *', 'egrep *'] })) =>
  runTool({
    tools: [
      createRunCommandTool({
        processes: testProcesses(),
        workspace: temp.workspace,
        permissions,
      }),
    ],
    call: {
      id: callIdSchema.parse('1'),
      name: 'run_command',
      input: { description: 'x', command },
    },
    signal: new AbortController().signal,
  });

const SECRETS = ['hunter2', 'hunter3', 'hunter4'];

describe('a recursive grep cannot read .env files the file tools refuse', () => {
  it.each([
    'grep -rn SECRET_NAME .',
    'grep -rn SECRET_NAME',
    'grep -Rn SECRET_NAME .',
    'grep -rn SECRET_NAME src config',
    'egrep -rn SECRET_NAME .',
    'grep -rnE "SECRET_NAME|x" .',
  ])('%s finds no secret', async (command) => {
    const result = await run(command);

    expect(result).toMatchObject({ isError: false });
    for (const secret of SECRETS) expect(result.content).not.toContain(secret);
  });

  it('finds the project’s own files, which is what a search is for', async () => {
    const result = await run('grep -rn SECRET_NAME src');

    expect(result.content).toContain('const x = SECRET_NAME;');
  });

  it.each([
    'grep -rn --include=* SECRET_NAME .',
    'grep -rn --include=*.ts SECRET_NAME .',
    'grep -rn --include=.env SECRET_NAME .',
  ])('asks about %s, so an --include cannot bring .env back unseen', async (command) => {
    const result = await run(command);

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('can name a .env file');
    expect(result.content).not.toContain('hunter2');
  });

  it('does not let an allowed grep stand for egrep, which is its own entry', async () => {
    const result = await run('egrep -rn SECRET_NAME .', testPermissions({ allow: ['grep *'] }));

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('is not allowed yet');
  });

  it('asks about a .env file named outright, and does not run', async () => {
    const result = await run('grep -n SECRET_NAME .env');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).not.toContain('hunter2');
  });

  it('asks about a glob that could name one', async () => {
    const result = await run('grep -n SECRET_NAME .e*');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).not.toContain('hunter2');
  });

  it('applies to a grep that is part of a pipe', async () => {
    const result = await run('grep -rn SECRET_NAME . | head -n 20');

    expect(result).toMatchObject({ isError: false });
    for (const secret of SECRETS) expect(result.content).not.toContain(secret);
  });

  it('applies when allow all is on, since the file tools refuse .env by name too', async () => {
    const result = await run('grep -rn SECRET_NAME .', testPermissions({ mode: 'allow_all' }));

    expect(result).toMatchObject({ isError: false });
    for (const secret of SECRETS) expect(result.content).not.toContain(secret);
  });
});
