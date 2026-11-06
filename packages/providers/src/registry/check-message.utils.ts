/** Known diagnoses return fixed text only, never an error body that might echo a credential. */
export function checkHttpMessage(params: { status: number; message: string }): string | undefined {
  const { status, message } = params;

  if (status === 429) {
    return 'HTTP 429: Rate limited. Wait and retry, or check your provider quota.';
  }

  if (status !== 400 && status !== 422) return undefined;

  const lower = message.toLowerCase();

  if (lower.includes('thinking') && lower.includes('adaptive') && lower.includes('not supported')) {
    return `HTTP ${String(status)}: This model requires adaptive thinking. Set Thinking mode to adaptive and leave Thinking budget empty.`;
  }

  if (lower.includes('max_tokens') || lower.includes('max tokens')) {
    return `HTTP ${String(status)}: Check Max tokens. It is the output limit per reply, not the context window, and must fit the model’s output limit.`;
  }

  return `HTTP ${String(status)}: The provider rejected the model settings. Check the deployment, output-token limit and thinking settings.`;
}
