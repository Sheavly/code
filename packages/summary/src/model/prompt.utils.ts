import type { SummaryBody } from '@sheavly/core/summary/summary.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import {
  MAX_TOOL_INPUT_CHARS,
  MAX_TOOL_NAME_CHARS,
  MAX_TOOL_RESULT_CHARS,
} from './model.constants.js';
import type { ModelSection } from '../sections/sections.types.js';
import {
  summaryInstructions as buildSummaryInstructions,
  summaryRequest as buildSummaryRequest,
} from './summary.prompt.js';

/** Cuts `text` at `max` characters and marks the cut. */
function cut(params: { text: string; max: number }): string {
  const { text, max } = params;

  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Written text is data between fixed lines, so it must not be able to carry the tags that frame
 * it: every `<` is swapped, in any spelling a model might read as a tag.
 */
function neutralize(text: string): string {
  return text.replaceAll(/[<＜]/g, '‹');
}

/**
 * One message of the span as a labelled block of text, long tool inputs and results cut. Text is
 * redacted before it is cut, so a credential is not left half-visible past a pattern.
 */
function renderMessage(params: { message: Message; redact: (text: string) => string }): string {
  const { message, redact } = params;

  if (message.role === 'user') return `[user]\n${neutralize(redact(message.content))}`;

  if (message.role === 'tool') {
    const label = message.isError ? 'tool error' : 'tool result';
    const text = cut({ text: redact(message.content), max: MAX_TOOL_RESULT_CHARS });

    return `[${label}]\n${neutralize(text)}`;
  }

  const calls = message.toolCalls.map((call) => {
    const input = cut({ text: redact(JSON.stringify(call.input)), max: MAX_TOOL_INPUT_CHARS });

    const name = cut({ text: redact(call.name), max: MAX_TOOL_NAME_CHARS });

    return `[assistant called ${neutralize(name)}] ${neutralize(input)}`;
  });

  return [message.content ? `[assistant]\n${neutralize(redact(message.content))}` : '', ...calls]
    .filter(Boolean)
    .join('\n');
}

/**
 * The span to summarize as plain text, one block per message, in order. `redact` hides credential
 * forms in what is sent to the summary model; the app knows its own forms, so it supplies it.
 */
export function renderSpan(params: {
  messages: readonly Message[];
  redact: (text: string) => string;
}): string {
  const { messages, redact } = params;

  return messages.map((message) => renderMessage({ message, redact })).join('\n\n');
}

/** Previous section bodies are redacted and tag-neutralized before the prompt frames them. */
export function renderPreviousSummary(params: {
  previous: SummaryBody | undefined;
  redact: (text: string) => string;
}): string | undefined {
  const { previous, redact } = params;

  return previous?.sections.length
    ? previous.sections.map(({ id, body }) => `"${id}":\n${neutralize(redact(body))}`).join('\n\n')
    : undefined;
}

/** Public compatibility entry point; authored instructions live in the prompt module. */
export function summaryInstructions(sections: readonly ModelSection[]): string {
  return buildSummaryInstructions(sections);
}

/** Redacts and renders history data before passing it to the internal request template. */
export function summaryRequest(params: {
  previous: SummaryBody | undefined;
  messages: readonly Message[];
  redact: (text: string) => string;
}): string {
  const { previous, messages, redact } = params;

  return buildSummaryRequest({
    previous: renderPreviousSummary({ previous, redact }),
    history: renderSpan({ messages, redact }),
  });
}
