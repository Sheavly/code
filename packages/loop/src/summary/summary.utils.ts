import type { ContextState } from '@sheavly/core/hook/hook.types';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import { formatCheckpoint } from '@sheavly/core/summary/summary.utils';
import type { SummaryBody, SummarySection } from '@sheavly/core/summary/summary.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { Message, SummaryMessage } from '@sheavly/protocol/message/message.types';
import { CHARS_PER_TOKEN } from './summary.constants.js';
import type { SummaryPolicy } from '@sheavly/core/summary/summary.types';

/** A rough token count (characters over four): no tokenizer, and only ever used to compare. */
export function estimateTokens(message: HistoryMessage): number {
  return Math.ceil(textOf(message).length / CHARS_PER_TOKEN);
}

function textOf(message: HistoryMessage): string {
  if (message.role === 'assistant') return message.content + JSON.stringify(message.toolCalls);

  if (message.role === 'summary') return formatCheckpoint(message);

  if (message.role === 'notice') return formatHarnessNotice(message.notice);

  return message.content;
}

/**
 * True when the context has less free room than the buffer: a share of the window, at least a
 * minimum, never more than half the window. False when the window or the last call's usage is
 * unknown, since nothing says the context is full.
 */
export function shouldSummarize(params: { context: ContextState; policy: SummaryPolicy }): boolean {
  const { context, policy } = params;
  const { window, used } = context;

  if (window === undefined || used === undefined) return false;

  const buffer = Math.min(Math.max(window * policy.freeShare, policy.minFreeTokens), window / 2);

  return window - used < buffer;
}

/**
 * `written` with `added` on top: an added section whose id is already there replaces it in
 * place, any other is appended.
 */
export function mergeSections(params: {
  written: readonly SummarySection[];
  added: readonly SummarySection[];
}): SummarySection[] {
  const merged = [...params.written];

  for (const section of params.added) {
    const index = merged.findIndex(({ id }) => id === section.id);

    if (index === -1) merged.push(section);
    else merged[index] = section;
  }

  return merged;
}

/** The newest checkpoint in history and where it is, if there is one. */
export function latestCheckpoint(
  history: readonly HistoryMessage[],
): { index: number; checkpoint: SummaryMessage } | undefined {
  const index = history.findLastIndex((message) => message.role === 'summary');
  const checkpoint = history[index];

  return checkpoint?.role === 'summary' ? { index, checkpoint } : undefined;
}

/** Where the messages a model still sees begin: the newest checkpoint's kept tail, or the start. */
function liveStart(history: readonly HistoryMessage[]): number {
  const latest = latestCheckpoint(history);

  return latest ? Math.max(0, latest.index - latest.checkpoint.kept) : 0;
}

/**
 * What a model is sent for these entries: checkpoints are left out (the view renders the newest),
 * and a stored notice becomes a user-role message holding its formatted text. It carries no `id`,
 * so it is never taken for a prompt a person typed (see `pinnedBefore`).
 */
function withoutCheckpoints(messages: readonly HistoryMessage[]): Message[] {
  return messages.flatMap((message): Message[] => {
    if (message.role === 'summary') return [];

    if (message.role === 'notice') {
      return [
        {
          role: 'user',
          content: formatHarnessNotice(message.notice),
          ...(message.at !== undefined && { at: message.at }),
        },
      ];
    }

    return [message];
  });
}

/**
 * The user messages a checkpoint whose tail starts at `start` still shows word for word although
 * they are older than the tail: the latest prompt a person typed (the host gives those an `id`)
 * and the latest user message of any kind, which a model must be answering. In a run of one
 * prompt followed by a long tool loop this is what lets everything after the prompt be
 * summarized while the request itself stays exact. In history order, without repeats.
 */
export function pinnedBefore(params: {
  history: readonly HistoryMessage[];
  start: number;
}): Message[] {
  return pinnedIndices(params).flatMap((index) => {
    const message = params.history[index];

    return message?.role === 'user' ? [message] : [];
  });
}

/** Where the pinned user messages older than `start` are, oldest first. */
function pinnedIndices(params: { history: readonly HistoryMessage[]; start: number }): number[] {
  const { history, start } = params;
  const prompt = history.findLastIndex((message) => message.role === 'user' && message.id);
  const latestUser = history.findLastIndex((message) => message.role === 'user');

  return [...new Set([prompt, latestUser])]
    .filter((index) => index >= 0 && index < start)
    .sort((a, b) => a - b);
}

/**
 * What a model is sent for `history`: the newest checkpoint rendered as one user message, then
 * the user messages it pins (see `pinnedBefore`), the messages it kept and everything after it.
 * Earlier checkpoints are folded into it, so they never show. Without a checkpoint it is the
 * history. Stored history is not changed.
 */
export function viewOf(history: readonly HistoryMessage[]): Message[] {
  const latest = latestCheckpoint(history);

  if (!latest) return withoutCheckpoints(history);

  const { checkpoint } = latest;
  const start = liveStart(history);
  const text: Message = {
    role: 'user',
    content: formatCheckpoint(checkpoint),
    ...(checkpoint.at !== undefined && { at: checkpoint.at }),
  };

  return [text, ...pinnedBefore({ history, start }), ...withoutCheckpoints(history.slice(start))];
}

/**
 * Where to cut `history`: the returned index is the first message kept word for word, so
 * `history.length - cut` is the checkpoint's `kept`. About `keepTokens` stay in the tail; a tool
 * call and its results are never split. The cut may pass the latest user message: the view
 * pins it (see `pinnedBefore`), so a run of one prompt and a long tool loop can still be
 * summarized and the request stays exact. Returns undefined when nothing but pinned messages
 * lies before the cut, since summarizing them would shrink nothing.
 */
export function chooseCut(params: {
  history: readonly HistoryMessage[];
  keepTokens: number;
}): number | undefined {
  const { history, keepTokens } = params;

  if (!history.some((message) => message.role === 'user')) return undefined;

  let cut = tailStart({ history, keepTokens });

  // A result belongs with the assistant message that called it, so the tail starts at the call.
  while (cut > 0 && history[cut]?.role === 'tool') cut -= 1;

  const pinned = new Set(pinnedIndices({ history, start: cut }));
  const floor = liveStart(history);
  const summarizable = history
    .slice(floor, cut)
    .filter((message, offset) => message.role !== 'summary' && !pinned.has(floor + offset));

  return summarizable.length > 0 ? cut : undefined;
}

/**
 * The first index from which the messages up to the end hold about `keepTokens`, looking back no
 * further than where the model's view begins: what an earlier checkpoint replaced is not the tail.
 */
function tailStart(params: { history: readonly HistoryMessage[]; keepTokens: number }): number {
  const { history, keepTokens } = params;
  const floor = liveStart(history);
  let tokens = 0;

  for (let index = history.length - 1; index >= floor; index--) {
    const message = history[index];

    // A checkpoint inside the tail is folded away by the next one, so it takes no room.
    if (message && message.role !== 'summary') tokens += estimateTokens(message);
    if (tokens >= keepTokens) return index;
  }

  return floor;
}

/**
 * What a summarizer is given for a cut: the newest checkpoint's sections to merge into, and the
 * messages since that checkpoint's tail began, up to the cut (the tail it kept, then what came
 * after). Without a checkpoint, everything before the cut.
 */
export function spanToSummarize(params: { history: readonly HistoryMessage[]; cut: number }): {
  previous: SummaryBody | undefined;
  messages: Message[];
} {
  const { history, cut } = params;
  const latest = latestCheckpoint(history);

  return {
    previous: latest && { sections: latest.checkpoint.sections },
    messages: withoutCheckpoints(history.slice(liveStart(history), cut)),
  };
}
