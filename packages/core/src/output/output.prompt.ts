/**
 * The lines that tell the model where a command's complete output is kept. They sit next to the
 * bounded preview, so a cut preview always says how to get the rest without running the command
 * again. @system-prompt-review
 */
export function renderOutputReference(params: {
  ref: string;
  bytes: string;
  state: 'capturing' | 'complete' | 'incomplete';
  reason: string | undefined;
  truncated: boolean;
}): string[] {
  const { ref, bytes, state, reason, truncated } = params;
  const states = {
    capturing: 'still capturing, more may arrive',
    complete: 'complete',
    incomplete: `INCOMPLETE${reason ? `: ${reason}` : ''}`,
  };
  const lines = [`Full output: output_ref=${ref} (${bytes} bytes stored, ${states[state]})`];

  if (truncated) {
    lines.push(
      'The output shown is a shortened preview. Read the rest with read_output (output_ref and offset) or find text in it with search_output. Do not rerun the command to see it.',
    );
  }

  if (state === 'incomplete') {
    lines.push(
      'The stored output is not everything the command printed; do not treat it as whole.',
    );
  }

  return lines;
}
