import { conversationDetailsSchema } from '@sheavly/protocol/server/server.validator';

export const lineChatDetails = conversationDetailsSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Test',
  session: 'main',
  running: false,
  startedAt: 0,
  workspace: '/workspace',
  profile: '22222222-2222-4222-8222-222222222222',
  model: {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Test',
    adapter: 'openai',
    model: 'test',
  },
  models: [],
  projectTrust: 'no_hooks',
  permissionMode: 'ask',
});
