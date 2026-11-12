/**
 * What stands in for an old tool result a model is no longer sent. It says the result was hidden
 * to save room and not lost, how big it was, and how to get it again; a line that says where the
 * complete output is kept (`output_ref`) is carried over whole so that way still works.
 * @system-prompt-review
 */
export function hiddenToolResult(params: { chars: number; reference: string | undefined }): string {
  const { chars, reference } = params;
  const lines = [
    `[An earlier tool result of ${String(chars)} characters was hidden to save room. It is not lost: call the tool again if you need it.]`,
  ];

  if (reference) lines.push(reference);

  return lines.join('\n');
}
