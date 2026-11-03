import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { createReadSkillTool } from '../read-skill.tool.js';

let base: string;
let root: string;
let home: string;
const signal = new AbortController().signal;

/** project/.agents/skills/review (with a linked file and a .env), home/.sheavly/skills/deploy. */
beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'read-skill-test-'));
  root = path.join(base, 'project');
  home = path.join(base, 'home');

  const review = path.join(root, '.agents', 'skills', 'review');
  const deploy = path.join(home, '.sheavly', 'skills', 'deploy');

  await mkdir(review, { recursive: true });
  await mkdir(deploy, { recursive: true });
  await writeFile(
    path.join(review, 'SKILL.md'),
    '---\nname: review\ndescription: Reviews.\n---\nSee checklist.md\n',
  );
  await writeFile(path.join(review, 'checklist.md'), 'CHECKLIST\n');
  await writeFile(path.join(review, '.env'), 'SECRET=1\n');
  await writeFile(
    path.join(deploy, 'SKILL.md'),
    `---\nname: deploy\ndescription: Deploys.\n---\n${Array.from({ length: 1100 }, (_, i) => `step ${String(i + 1)}`).join('\n')}\n`,
  );
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const read = (input: { name: string; file?: string; startLine?: number }) =>
  runTool({
    tools: [createReadSkillTool({ root, home })],
    call: {
      id: callIdSchema.parse('1'),
      name: 'read_skill',
      input: { description: 'x', ...input },
    },
    signal,
  });

describe('read_skill', () => {
  it('reads a project skill’s SKILL.md and the files it links to', async () => {
    expect(await read({ name: 'review' })).toMatchObject({
      isError: false,
      content: expect.stringContaining('See checklist.md') as string,
    });
    expect(await read({ name: 'review', file: 'checklist.md' })).toMatchObject({
      isError: false,
      content: 'CHECKLIST\n',
    });
  });

  it('reads a user skill outside the workspace, capped like read_file, naming read_skill', async () => {
    const first = await read({ name: 'deploy' });
    const rest = await read({ name: 'deploy', startLine: 1001 });

    expect(first.isError).toBe(false);
    expect(first.content).toContain('To read on, call read_skill with startLine 1001.');
    expect(rest.content).toContain('step 1100');
  });

  it('refuses an unknown skill, files outside its folder, and .env files', async () => {
    expect(await read({ name: 'nope' })).toMatchObject({
      isError: true,
      content: expect.stringContaining('No skill is called nope') as string,
    });
    expect(
      await read({ name: 'review', file: '../../../../home/.sheavly/skills/deploy/SKILL.md' }),
    ).toMatchObject({ isError: true, content: expect.stringContaining('outside') as string });
    expect(await read({ name: 'review', file: '.env' })).toMatchObject({
      isError: true,
      content: expect.stringContaining('.env') as string,
    });
  });
});
