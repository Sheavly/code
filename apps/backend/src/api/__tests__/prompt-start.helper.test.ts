import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { recordPromptStart } from '../prompt-start.helper.js';

describe('recordPromptStart', () => {
  it('records where the prompt resumes the session, not entries made while it was prepared', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });

    sessions.idle({ id: main.id, outcome: 'completed' });

    const recorded = recordPromptStart({ sessions, mainId: main.id });

    // Made meanwhile, by something else than this prompt.
    sessions.publish({ sessionId: main.id, event: { seq: 0, type: 'text_delta', text: 'late' } });
    sessions.resume(main.id);
    recorded.stop();

    const resumed: number[] = [];

    sessions.subscribeEntries(
      (entry) => {
        if (entry.kind === 'update' && entry.update.type === 'session_resumed') {
          resumed.push(entry.seq);
        }
      },
      { replay: true },
    );

    expect(resumed).toHaveLength(1);
    expect(recorded.seq()).toBe(resumed[0]);
  });

  it('records nothing for the first prompt, whose session never resumes', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });
    const recorded = recordPromptStart({ sessions, mainId: main.id });

    sessions.publish({ sessionId: main.id, event: { seq: 0, type: 'text_delta', text: 'x' } });
    recorded.stop();

    expect(recorded.seq()).toBeUndefined();
  });
});
