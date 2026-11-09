import { describe, expect, it } from 'vitest';
import type { Message } from '@sheavly/protocol/message/message.types';
import {
  messageIdSchema,
  summarySectionIdSchema,
} from '@sheavly/protocol/message/message.validator';
import { SummaryDefinitionError } from '../../errors/summary.errors.js';
import { userMessagesSection } from '../../sections/user-messages.utils.js';
import { windowSection } from '../../sections/window.utils.js';
import { rulesSummarizer } from '../rules.utils.js';

/** A message a person typed: the host gives it an id. */
const user = (content: string): Message => ({
  role: 'user',
  content,
  id: messageIdSchema.parse('00000000-0000-4000-8000-000000000001'),
});
const signal = new AbortController().signal;

describe('rulesSummarizer', () => {
  it('writes each section from the span, with no model and no usage to report', async () => {
    const summarizer = rulesSummarizer({ sections: [userMessagesSection(), windowSection] });
    const result = await summarizer.summarize({ messages: [user('Fix it.')], signal });

    expect(summarizer.name).toBe('rules');
    expect(result.usage).toBeUndefined();
    expect(result.sections.map(({ id, title, body }) => [id, title, body])).toEqual([
      ['user-messages', 'What the user asked for', '- Fix it.'],
      ['window', 'Earlier history', '- 1 earlier message is no longer shown.'],
    ]);
  });

  it('merges into the previous checkpoint by section id instead of starting over', async () => {
    const summarizer = rulesSummarizer({ sections: [userMessagesSection(), windowSection] });
    const first = await summarizer.summarize({ messages: [user('One.')], signal });
    const second = await summarizer.summarize({
      messages: [user('Two.')],
      previous: first,
      signal,
    });

    expect(second.sections.map((section) => section.body)).toEqual([
      '- One.\n- Two.',
      '- 2 earlier messages are no longer shown.',
    ]);
  });

  it('leaves out a section that has nothing to say', async () => {
    const summarizer = rulesSummarizer({ sections: [userMessagesSection(), windowSection] });
    const result = await summarizer.summarize({ messages: [], signal });

    expect(result.sections).toEqual([]);
  });

  it('gives its sections branded ids the loop can store', async () => {
    const result = await rulesSummarizer({ sections: [windowSection] }).summarize({
      messages: [user('a')],
      signal,
    });

    expect(result.sections[0]?.id).toBe(summarySectionIdSchema.parse('window'));
  });

  it('takes a name, and refuses no sections or a repeated section id at definition', () => {
    expect(rulesSummarizer({ name: 'window', sections: [windowSection] }).name).toBe('window');
    expect(() => rulesSummarizer({ sections: [] })).toThrow(SummaryDefinitionError);
    expect(() => rulesSummarizer({ sections: [windowSection, windowSection] })).toThrow(
      'two sections share an id',
    );
  });
});
