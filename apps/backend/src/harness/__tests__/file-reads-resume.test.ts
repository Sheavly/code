import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { until } from '@sheavly/testing/wait/until.fake';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { FileConversationStore } from '@sheavly/storage/conversation-store/conversation-store.service';
import { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { useTempRepo } from '@sheavly/workspace/testing/git-repo.fake';
import { memoryTrust } from '@sheavly/workspace/testing/trust.fake';
import { createBackendHarness } from '../harness.helper.js';
import { askingPermissions } from '../../testing/permissions.fake.js';

const repo = useTempRepo({ prefix: 'file-reads-resume-', perTest: true });
const ID = conversationIdSchema.parse('00000000-0000-4000-8000-000000000002');
const folder = () => path.join(repo.base, 'store');
const newStore = () => new FileConversationStore({ folder: folder(), onProblem: () => undefined });

/** A harness for conversation `ID` over its `shell.json`, as a reopen builds one. */
function open(onProblem?: (caughtError: unknown) => void) {
  const persistence = memoryTrust({ file: path.join(repo.base, 'trusted.json') });

  return createBackendHarness({
    shell: newStore().shell(ID),
    onFileReadsProblem: onProblem,
    permissions: askingPermissions(),
    trustStore: new TrustStore({ persistence }),
    workspaceRoot: repo.main,
    title: 'reads',
    env: process.env,
    provider: routedProvider({ reads: [say('ok')] }),
  });
}

type OpenHarness = Awaited<ReturnType<typeof open>>;

const call = (harness: OpenHarness, name: string, input: Record<string, unknown>) => {
  const tool = harness.tools.find((candidate) => candidate.name === name);

  if (!tool) throw new Error(`${name} is not in the run`);

  return runTool({
    tools: [tool],
    call: { id: callIdSchema.parse(name), name, input: { description: name, ...input } },
    signal: new AbortController().signal,
    session: harness.mainSession,
  });
};

const edit = (harness: OpenHarness) =>
  call(harness, 'edit_file', { path: 'a.ts', oldText: 'const a = 1;', newText: 'const a = 2;' });

/** The prompt ends: the main session goes idle, which is when the reads are kept. */
async function endPrompt(harness: OpenHarness) {
  harness.sessions.idle({ id: harness.mainSession.id, outcome: 'completed' });
  let kept = false;

  // The save runs after the session goes idle; `until` takes a synchronous check, so look first.
  await until(() => {
    void newStore()
      .shell(ID)
      .load()
      .then((document) => {
        kept = typeof document === 'object' && document !== null && 'fileReads' in document;
      });

    return kept;
  });
}

describe('the file reads of a resumed conversation', () => {
  it('let an edit go through after a reopen without reading the file again', async () => {
    await writeFile(path.join(repo.main, 'a.ts'), 'const a = 1;\n');

    const first = await open();

    expect(await call(first, 'read_file', { path: 'a.ts' })).toMatchObject({ isError: false });
    await endPrompt(first);

    // A restart: a new harness over the same stored conversation, as `reopen` builds it.
    const reopened = await open();

    expect(await edit(reopened)).toMatchObject({ isError: false });
    expect(await readFile(path.join(repo.main, 'a.ts'), 'utf8')).toBe('const a = 2;\n');
  });

  it('still ask for a new read when the file changed while the conversation was closed', async () => {
    await writeFile(path.join(repo.main, 'a.ts'), 'const a = 1;\n');

    const first = await open();

    await call(first, 'read_file', { path: 'a.ts' });
    await endPrompt(first);
    await writeFile(path.join(repo.main, 'a.ts'), 'const a = 1; // changed elsewhere\n');

    const result = await edit(await open());

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('changed since you read it');
  });

  it('start with nothing read when the stored reads are damaged, and say so', async () => {
    await writeFile(path.join(repo.main, 'a.ts'), 'const a = 1;\n');
    await newStore()
      .shell(ID)
      .update(() => ({ fileReads: { '/x': { chunks: 'not a list' } } }));

    const problems: unknown[] = [];
    const reopened = await open((caughtError) => problems.push(caughtError));
    const result = await edit(reopened);

    expect(problems).toHaveLength(1);
    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('You have not read a.ts');
  });
});
