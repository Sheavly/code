/** Shared by rendering and history lookup; the trailing newline is part of the prefix. */
export function instructionContextOpening(name: string): string {
  return `<instruction-context name="${name}">\n`;
}

export function renderInstructionContext(params: {
  name: string;
  instructions: string | undefined;
}): string {
  const { name, instructions } = params;

  return `${instructionContextOpening(name)}${instructions ?? 'No instructions currently apply.'}\n</instruction-context>`;
}
