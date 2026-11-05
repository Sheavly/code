import { describe, expect, it } from 'vitest';
import {
  answerApprovalRequestSchema,
  conversationDetailsSchema,
  conversationsResponseSchema,
  sendPromptRequestSchema,
  serverErrorSchema,
  skillsResponseSchema,
  startConversationRequestSchema,
  streamQuerySchema,
  switchModelRequestSchema,
  conversationIdSchema,
} from '../server.validator.js';

/** A model's id: a lowercase UUID, the only thing a switch is keyed by. */
const FAST = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';
/** A conversation's id: a lowercase UUID too. */
const CONVERSATION = '00000000-0000-4000-8000-0000000000ab';

describe('conversationIdSchema', () => {
  it('takes a lowercase UUID: it names a folder on disk and nothing else may', () => {
    expect(conversationIdSchema.parse(CONVERSATION)).toBe(CONVERSATION);
  });

  it('refuses anything that could name another path, or the same folder twice', () => {
    for (const bad of [
      '',
      'c1',
      'nope',
      '..',
      '../config',
      `${CONVERSATION}/..`,
      CONVERSATION.toUpperCase(),
      `${CONVERSATION} `,
      CONVERSATION.replaceAll('-', ''),
    ]) {
      expect(conversationIdSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('sendPromptRequestSchema', () => {
  it('takes text from a script, or parts from a UI', () => {
    expect(sendPromptRequestSchema.parse({ text: 'fix it /git' })).toEqual({ text: 'fix it /git' });

    const parts = [
      { type: 'text', text: 'please ' },
      { type: 'skill', name: 'review' },
    ];

    expect(sendPromptRequestSchema.parse({ parts })).toEqual({ parts });
  });

  it('refuses both at once, neither, an empty prompt, or a name no skill can have', () => {
    for (const body of [
      { text: 'a', parts: [{ type: 'text', text: 'a' }] },
      {},
      { text: '' },
      { parts: [] },
      { parts: [{ type: 'skill', name: 'Not A Name' }] },
      { parts: [{ type: 'chip', name: 'review' }] },
    ]) {
      expect(sendPromptRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('the other requests', () => {
  it('starts a conversation empty or from saved messages, with parts kept', () => {
    const messages = [
      { role: 'user', content: 'Run review… then', parts: [{ type: 'skill', name: 'review' }] },
    ];

    expect(startConversationRequestSchema.parse({})).toEqual({});
    expect(startConversationRequestSchema.parse({ messages })).toEqual({ messages });
  });

  it('filters the stream by session, subtree and replay, each optional', () => {
    expect(streamQuerySchema.parse({})).toEqual({});
    expect(streamQuerySchema.parse({ session: 's1', subtree: true, replay: true })).toEqual({
      session: 's1',
      subtree: true,
      replay: true,
    });
    expect(streamQuerySchema.safeParse({ replay: 'yes' }).success).toBe(false);
  });

  it('answers an approval with a decision the approval registry takes', () => {
    expect(answerApprovalRequestSchema.parse({ response: { decision: 'approve' } })).toEqual({
      response: { decision: 'approve' },
    });
    expect(answerApprovalRequestSchema.safeParse({ response: { decision: 'maybe' } }).success).toBe(
      false,
    );
  });
});

describe('the responses', () => {
  it('describes a conversation’s run, with the models it can switch to', () => {
    const model = { id: FAST, name: 'fast', adapter: 'openai', model: 'gpt-5-mini' };
    const details = {
      id: CONVERSATION,
      title: 'Chat',
      session: 's1',
      running: false,
      startedAt: 1,
      workspace: '/work',
      profile: '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71',
      model,
      models: [model],
      projectTrust: 'untrusted',
      permissionMode: 'ask',
    };

    expect(conversationDetailsSchema.parse(details)).toEqual(details);
    expect(conversationDetailsSchema.safeParse({ ...details, projectTrust: 'maybe' }).success).toBe(
      false,
    );
    expect(
      conversationDetailsSchema.safeParse({ ...details, model: { ...model, id: undefined } })
        .success,
    ).toBe(false);
  });

  it('switches models by id: a name is a label, and never switches anything', () => {
    expect(switchModelRequestSchema.parse({ id: FAST })).toEqual({ id: FAST });
    expect(switchModelRequestSchema.safeParse({ name: 'fast' }).success).toBe(false);
    expect(switchModelRequestSchema.safeParse({ id: 'fast' }).success).toBe(false);
    expect(switchModelRequestSchema.safeParse({ id: FAST.toUpperCase() }).success).toBe(false);
    expect(switchModelRequestSchema.safeParse({ id: FAST, name: 'fast' }).data).toEqual({
      id: FAST,
    });
  });

  it('lists live conversations with what another UI needs to join one', () => {
    const summary = {
      id: CONVERSATION,
      title: 'Chat',
      session: 's1',
      running: true,
      startedAt: 1,
    };

    expect(conversationsResponseSchema.parse({ conversations: [summary] })).toEqual({
      conversations: [summary],
    });
    expect(
      conversationsResponseSchema.safeParse({ conversations: [{ ...summary, running: 'yes' }] })
        .success,
    ).toBe(false);
  });

  it('lists skills without their bodies', () => {
    const skill = { name: 'review', description: 'Reviews.', manualOnly: false, scope: 'project' };

    expect(skillsResponseSchema.parse({ skills: [skill] })).toEqual({ skills: [skill] });
    expect(
      skillsResponseSchema.safeParse({ skills: [{ ...skill, scope: 'elsewhere' }] }).success,
    ).toBe(false);
  });

  it('gives every failure a known code and a message', () => {
    const failure = { error: { code: 'session_running', message: 'A prompt is running.' } };

    expect(serverErrorSchema.parse(failure)).toEqual(failure);
    expect(serverErrorSchema.safeParse({ error: { code: 'oops', message: 'x' } }).success).toBe(
      false,
    );
  });
});
