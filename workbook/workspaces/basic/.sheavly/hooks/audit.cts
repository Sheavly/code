// aroundToolCall (.cts, CommonJS + TypeScript): wraps every tool call; nothing printed, the
// workbook records the results anyway.
type Result = { content: string; isError: boolean };
module.exports = {
  name: 'audit',
  aroundToolCall: async ({ next }: { next: () => Promise<Result> }) => next(),
};
