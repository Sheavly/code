export const messageAgentPrompts = {
  description:
    'Send a message to a sub-agent you started, while it keeps working: new instructions, a ' +
    'narrower focus, an answer it needs. It sees the message at its next step. Address it by ' +
    'the session id start_agent returned.',
  session: "The sub-agent's session id, from start_agent",
  message: 'What to tell it',
};
