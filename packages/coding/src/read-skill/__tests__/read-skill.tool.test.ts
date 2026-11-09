import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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
const longChecklist = `${'x'.repeat(110_000)}\nFINAL CHECKLIST RULE\n`;
const deployText = `---\nname: deploy\ndescription: Deploys.\n---\n${Array.from({ length: 1100 }, (_, i) => `step ${String(i + 1)}`).join('\n')}\n${longChecklist}`;

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
  await writeFile(path.join(review, 'long-checklist.md'), longChecklist);
  await symlink(path.join(review, 'long-checklist.md'), path.join(review, 'linked.md'));
  await writeFile(path.join(review, '.env'), 'SECRET=1\n');
  await writeFile(path.join(review, '.env.local'), 'SECRET=2\n');
  await symlink(path.join(review, '.env'), path.join(review, 'secret-link.md'));
  await symlink(path.join(home, '.sheavly/skills/deploy/SKILL.md'), path.join(review, 'escape.md'));
  await writeFile(path.join(deploy, 'SKILL.md'), deployText);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const read = (input: { name: string; file?: string }) =>
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

  it('reads a user SKILL.md outside the workspace beyond 1,000 lines and 100,000 characters', async () => {
    expect(await read({ name: 'deploy' })).toMatchObject({ isError: false, content: deployText });
  });

  it('returns linked files beyond 100,000 characters, including confined symlinks', async () => {
    for (const file of ['long-checklist.md', 'linked.md']) {
      expect(await read({ name: 'review', file })).toMatchObject({
        isError: false,
        content: longChecklist,
      });
    }
  });

  it('refuses an unknown skill, files outside its folder, and .env files', async () => {
    expect(await read({ name: 'nope' })).toMatchObject({
      isError: true,
      content: expect.stringContaining('No skill is called nope') as string,
    });
    expect(
      await read({ name: 'review', file: '../../../../home/.sheavly/skills/deploy/SKILL.md' }),
    ).toMatchObject({ isError: true, content: expect.stringContaining('outside') as string });
    expect(await read({ name: 'review', file: 'escape.md' })).toMatchObject({
      isError: true,
      content: expect.stringContaining('outside') as string,
    });

    for (const file of ['.env', '.env.local', 'secret-link.md']) {
      expect(await read({ name: 'review', file })).toMatchObject({
        isError: true,
        content: expect.stringContaining('.env') as string,
      });
    }
  });
});
