/** How complete the log is, in words the model can act on. */
export function stateLine(log: { status: string; reason?: string | undefined }): string {
  if (log.status === 'incomplete') return `INCOMPLETE: ${log.reason ?? 'some output was not kept'}`;

  return log.status === 'capturing' ? 'still capturing; more may arrive' : 'complete';
}
