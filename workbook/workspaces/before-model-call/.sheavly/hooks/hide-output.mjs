// beforeModelCall (.mjs): the model sees only the latest tool result in full. Older ones are
// replaced by a placeholder for that call; stored history is untouched. Deterministic: what is
// hidden depends only on position, so the prompt prefix stays the same from call to call.
export default {
  name: 'hide-output',
  beforeModelCall: async ({ messages }) => {
    const lastTool = messages.findLastIndex((message) => message.role === 'tool');

    return messages.map((message, index) =>
      message.role === 'tool' && index < lastTool
        ? { ...message, content: '[output hidden by hide-output]' }
        : message,
    );
  },
};
