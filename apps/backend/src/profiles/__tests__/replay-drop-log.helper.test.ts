import { describe, expect, it } from 'vitest';
import { MAX_TOLD_DROPS } from '../profiles.constants.js';
import { createReplayDropLog } from '../replay-drop-log.helper.js';

describe('createReplayDropLog', () => {
  it('reports a drop once however many calls repeat it', () => {
    const lines: string[] = [];
    const heard = createReplayDropLog((text) => lines.push(text));

    for (let call = 0; call < 5; call++) {
      heard({ reason: 'prefix_changed', source: 'messages:https://a.test/v1#m' });
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('prefix_changed');
    expect(lines[0]).toContain('messages:https://a.test/v1#m');
  });

  it('reports a different reason or source as its own drop', () => {
    const lines: string[] = [];
    const heard = createReplayDropLog((text) => lines.push(text));

    heard({ reason: 'prefix_changed', source: 'messages:https://a.test/v1#m' });
    heard({ reason: 'source_mismatch', source: 'messages:https://a.test/v1#m' });
    heard({ reason: 'prefix_changed', source: 'messages:https://b.test/v1#m' });
    heard({ reason: 'replay_off' });
    heard({ reason: 'replay_off' });

    expect(lines).toHaveLength(4);
  });

  it('remembers a bounded number of kinds, forgetting the oldest past the cap', () => {
    const lines: string[] = [];
    const heard = createReplayDropLog((text) => lines.push(text));
    const drop = (n: number) =>
      ({ reason: 'prefix_changed', source: `chat:https://a${n}.test#m` }) as const;

    for (let n = 0; n <= MAX_TOLD_DROPS; n++) heard(drop(n));

    expect(lines).toHaveLength(MAX_TOLD_DROPS + 1);

    // The newest is still remembered; the first was forgotten and is reported once more.
    heard(drop(MAX_TOLD_DROPS));
    expect(lines).toHaveLength(MAX_TOLD_DROPS + 1);
    heard(drop(0));
    expect(lines).toHaveLength(MAX_TOLD_DROPS + 2);
  });

  it('keeps each handler apart, so a new backend reports again', () => {
    const lines: string[] = [];
    const drop = { reason: 'message_edited', source: 'chat:https://a.test/v1#m' } as const;

    createReplayDropLog((text) => lines.push(text))(drop);
    createReplayDropLog((text) => lines.push(text))(drop);

    expect(lines).toHaveLength(2);
  });
});
