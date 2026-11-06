import type { ProviderRequest } from '@sheavly/core/provider/provider.types';

/** `text` squeezed onto one line, cut at `max` characters with an ellipsis. */
function clip(params: { text: string; max: number }): string {
  return params.text.length > params.max ? `${params.text.slice(0, params.max)}…` : params.text;
}

/** `text` on one line, cut at `max`: whitespace runs become one space. */
function oneLine(params: { text: string; max: number }): string {
  return clip({ text: params.text.replace(/\s+/g, ' ').trim(), max: params.max });
}

/** One model call for a person to read: whose task, which tools, the system prompt, the latest message. */
export function describeModelCall(request: ProviderRequest): string {
  const task = request.messages.find((m) => m.role === 'user')?.content ?? '';
  const instructions = request.instructions ?? '';
  const latest = request.messages.findLast((m) => m.role === 'user')?.content ?? '';
  const prompt = instructions
    ? `${instructions.length} chars: "${oneLine({ text: instructions, max: 90 })}"`
    : 'none';

  return (
    `\n  · model call for "${oneLine({ text: task, max: 40 })}" · ${request.messages.length} messages\n` +
    `    tools: ${request.tools.map((tool) => tool.name).join(', ') || 'none'}\n` +
    `    system prompt: ${prompt}\n` +
    `    latest user message: "${oneLine({ text: latest, max: 110 })}"\n`
  );
}

/**
 * One model call as a line of `model-calls.jsonl`: when it was sent (`at`, epoch milliseconds, as
 * every timestamp is) and everything the model got, with the tools by name. The signal can't be
 * serialized and isn't what the model was sent.
 */
export function modelCallLine(params: { request: ProviderRequest; at: number }): string {
  const { signal: _signal, ...sent } = params.request;

  return `${JSON.stringify({ at: params.at, ...sent, tools: sent.tools.map((tool) => tool.name) })}\n`;
}
