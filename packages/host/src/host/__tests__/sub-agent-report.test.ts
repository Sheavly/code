import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import {
  calls,
  routedProvider,
  say,
  toolCall,
} from '@sheavly/testing/provider/routed-provider.fake';
import { toolRunner } from '@sheavly/testing/tool/tool-runner.fake';
import type { Script } from '@sheavly/testing/provider/provider.types';

/** The three reports from the issue: each lost something on the way to the parent. */
const MULTILINE =
  'REPORT-BEGIN\n' +
  Array.from({ length: 80 }, (_, index) => `Finding ${String(index)}: ${'e'.repeat(90)}`).join(
    '\n',
  ) +
  '\nREPORT-END';
const SINGLE_PARAGRAPH = `REPORT-BEGIN ${'e'.repeat(1_500)} REPORT-END`;
const FIRST_HALF = 'FIRST-HALF: important findings';
const LAST_HALF = 'LAST-HALF: checks and blockers';

const stop = (stopReason: 'max_tokens' | 'end_turn'): StreamEvent => ({ type: 'done', stopReason });
const text = (content: string): StreamEvent => ({ type: 'text_delta', text: content });

/** Runs a main session that starts one sub-agent, and keeps what its next model call was sent. */
async function handoff(child: Script[]) {
  const sessions = new SessionRegistry();
  const tasks = new TaskRegistry();
  let seen: readonly Message[] = [];
  const provider = routedProvider({
    Main: [
      calls(
        toolCall({ id: 'm1', name: 'start_agent', input: { title: 'Researcher', task: 'Child' } }),
      ),
      (request) => {
        seen = request.messages;

        return [text('Read it.'), stop('end_turn')];
      },
    ],
    Child: child,
  });
  const tool = createSubAgentTool({ sessions, tasks, provider, runAgent: runSession, tools: [] });
  const main = sessions.startMain({ title: 'Main' });
  const result = await runSession({
    provider,
    tools: [tool, ...createTaskTools(tasks)],
    messages: [{ role: 'user', content: 'Main' }],
    tasks,
    session: { registry: sessions, ref: main },
  });
  const notice = result.messages.find((message) => message.role === 'notice');
  const sentToParent = seen.filter((message) => message.role === 'user').at(-1)?.content ?? '';

  return { sessions, tasks, main, result, notice, sentToParent };
}

describe('a sub-agent report reaches its parent whole', () => {
  it('delivers a multiline report past 4,000 characters, nothing cut and nothing omitted', async () => {
    const { result, notice, sentToParent } = await handoff([say(MULTILINE)]);

    expect(MULTILINE.length).toBe(8_253);
    expect(result.reason).toBe('completed');
    expect(notice?.role === 'notice' && notice.notice).toMatchObject({
      kind: 'agent-report',
      outcome: 'completed',
      report: MULTILINE,
    });
    // What the model is sent: the whole report inside the notice envelope, not its last 4,000.
    expect(sentToParent).toContain(MULTILINE);
    expect(sentToParent).not.toContain('[…]');
    expect(sentToParent.startsWith('<harness-notice kind="agent-report">')).toBe(true);
  });

  it('delivers a single paragraph past the 1,000-character line limit', async () => {
    const { notice, sentToParent } = await handoff([say(SINGLE_PARAGRAPH)]);

    expect(SINGLE_PARAGRAPH.length).toBe(1_524);
    expect(notice?.role === 'notice' && notice.notice).toMatchObject({ report: SINGLE_PARAGRAPH });
    expect(sentToParent).toContain(SINGLE_PARAGRAPH);
  });

  it('delivers every part of a report cut at the output limit and continued, in order', async () => {
    const { notice, sentToParent } = await handoff([
      () => [text(FIRST_HALF), stop('max_tokens')],
      () => [text(LAST_HALF), stop('end_turn')],
    ]);

    expect(notice?.role === 'notice' && notice.notice).toMatchObject({
      outcome: 'completed',
      report: FIRST_HALF + LAST_HALF,
    });
    expect(sentToParent).toContain(FIRST_HALF + LAST_HALF);
  });

  it('leaves out what the sub-agent said before its last tool call', async () => {
    const { notice } = await handoff([
      calls(toolCall({ id: 's1', name: 'report_status', input: { status: 'working' } })),
      say('The answer.'),
    ]);

    expect(notice?.role === 'notice' && notice.notice).toMatchObject({ report: 'The answer.' });
  });

  it('keeps progress out of the report, so it cannot displace it', async () => {
    const { notice, sentToParent } = await handoff([
      calls(toolCall({ id: 's1', name: 'report_status', input: { status: 'reading the files' } })),
      say(MULTILINE),
    ]);

    expect(notice?.role === 'notice' && notice.notice).toMatchObject({
      kind: 'agent-report',
      report: MULTILINE,
      agent: { status: 'reading the files' },
    });
    expect(sentToParent).not.toContain('[status]');
  });

  it('says a delivered report was released: the notice in history is where it stays readable', async () => {
    const { tasks, notice } = await handoff([say(MULTILINE)]);
    const run = toolRunner(createTaskTools(tasks));
    const shown = await run('c1', 'task_status', { id: 't1' });

    expect(notice?.role === 'notice' && notice.notice).toMatchObject({ report: MULTILINE });
    expect(shown).toMatchObject({ isError: true });
    expect(shown.role === 'tool' && shown.content).toContain('already reported and released');
  });

  it('puts the card data in the typed notice, for a UI to render from', async () => {
    const { sessions, notice, main } = await handoff([say('Done.')]);
    const agent =
      notice?.role === 'notice' && notice.notice.kind === 'agent-report'
        ? notice.notice.agent
        : undefined;

    // The session is released once the report is delivered: the notice is where its card stays.
    expect(agent && sessions.isReleased(agent.id)).toBe(true);
    expect(sessions.children(main.id)).toEqual([]);
    expect(notice?.role === 'notice' && notice.notice).toMatchObject({
      kind: 'agent-report',
      taskId: 't1',
      agent: {
        id: agent?.id,
        title: 'Researcher',
        parentId: main.id,
        startedByCall: 'm1',
        depth: 2,
      },
    });
  });
});

describe('ordinary background tasks keep their bounded preview', () => {
  it('still shortens a shell task’s long output to a preview, and has no report', async () => {
    const tasks = new TaskRegistry();

    tasks.start({
      command: 'build',
      description: 'build',
      run: async ({ onOutput }) => {
        onOutput(`${`${'x'.repeat(99)}\n`.repeat(200)}END`);

        return { exitCode: 0 };
      },
    });
    await tasks.nextSettled();

    const run = toolRunner(createTaskTools(tasks));
    const shown = await run('c1', 'task_status', { id: 't1' });
    const content = shown.role === 'tool' ? shown.content : '';

    expect(tasks.report(tasks.list()[0]?.id ?? ('' as never))).toBeUndefined();
    expect(content).toContain('[…]');
    expect(content.length).toBeLessThan(4_300);
  });
});
