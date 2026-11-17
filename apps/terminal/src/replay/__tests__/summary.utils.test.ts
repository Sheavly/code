import { describe, expect, it } from 'vitest';
import type { StoredStream } from '../replay.types.js';
import { describeSummary } from '../summary-text.utils.js';
import { summarizeStream } from '../summary.utils.js';
import { fixtureEntries } from '../testing/stream.fake.js';

function stored(overrides: Partial<StoredStream> = {}): StoredStream {
  return {
    source: 'conversation',
    file: 'stream.jsonl',
    entries: fixtureEntries(),
    truncatedLastLine: false,
    invalidLines: [],
    ...overrides,
  };
}

describe('summarizeStream', () => {
  it('counts entries per kind, and gives each session and task its last state', () => {
    const summary = summarizeStream(stored());

    expect(summary.kinds).toMatchObject({
      'event:text_delta': 1,
      'event:done': 1,
      'update:session_started': 2,
      'task:task_ended': 1,
    });
    expect(summary.sessions).toEqual([
      { id: 'main', title: 'Fixture', state: 'running' },
      {
        id: 'helper',
        title: 'Look around',
        parent: 'main',
        state: 'completed',
        lastOutcome: 'completed',
      },
    ]);
    expect(summary.tasks).toEqual([
      { id: 'task-1', command: 'npm test', status: 'completed', exitCode: 0 },
    ]);
    expect(summary.outcome).toBe('completed');
    expect(describeSummary(summary)).toContain('Findings:\n  none');
  });

  it('flags a stream whose main session never says done', () => {
    const entries = fixtureEntries().slice(0, -1);
    const summary = summarizeStream(stored({ entries }));

    expect(summary.outcome).toBeUndefined();
    expect(describeSummary(summary)).toContain('✗ no `done` of the main session');
  });

  it('flags a gap in seq', () => {
    const entries = fixtureEntries().filter((entry) => entry.seq !== 4);
    const summary = summarizeStream(stored({ entries }));

    expect(summary.gaps).toEqual([{ after: 3, next: 5 }]);
    expect(describeSummary(summary)).toContain('✗ seq gap: 3 is followed by 5');
  });

  it('flags a truncated last line and lines that are not entries', () => {
    const text = describeSummary(
      summarizeStream(stored({ truncatedLastLine: true, invalidLines: [2, 7] })),
    );

    expect(text).toContain('✗ the last line is cut off');
    expect(text).toContain('✗ not an entry: line(s) 2, 7');
  });
});
