import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';
import { defaultPalette } from '../../theme/palette.utils.js';
import { editorFrame, liveLayout, transcriptRows } from '../layout.utils.js';
import type { ReactScreenProps } from '../react-screen.types.js';

function frame(patch: Partial<ReactScreenProps> = {}): ReactScreenProps {
  return {
    history: [],
    live: '',
    approval: '',
    queue: '',
    status: { state: 'ready', model: 'Fast', mode: 'ask', tasks: 0 },
    colors: defaultPalette.colors,
    editor: { lines: ['border', 'input', 'border'], cursor: { x: 0, y: 1 } },
    columns: 80,
    rows: 24,
    ...patch,
  };
}

/** Every row the footer draws: the tail, the status line, then the rows under it. */
function footerRows(layout: ReturnType<typeof liveLayout>): string[] {
  return [...layout.tail, 'STATUS', ...layout.lines];
}

describe('editorFrame', () => {
  it('keeps the caret in display columns and removes private markers', () => {
    const result = editorFrame([`界${CURSOR_MARKER}\u001b_pi:fc\u0007x\u001b_pi:/fc\u0007`]);

    expect(result).toEqual({ lines: ['界x'], cursor: { x: 2, y: 0 } });
  });
});

describe('transcriptRows', () => {
  it('splits a huge line into bounded static items, retaining styles and blank lines', () => {
    const lines = transcriptRows({ text: `\u001b[31m${'界'.repeat(1000)}\u001b[0m`, columns: 40 });

    expect(lines.length).toBeGreaterThan(24);
    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
    expect(lines.map(stripTerminalSequences).join('')).toBe('界'.repeat(1000));
    expect(transcriptRows({ text: '', columns: 40 })).toEqual(['']);
  });
});

describe('liveLayout', () => {
  it('draws the unfinished reply above the status line, never under it', () => {
    const layout = liveLayout(frame({ live: 'one\ntwo' }));

    expect(footerRows(layout)).toEqual(['one', 'two', 'STATUS', 'border', 'input', 'border']);
    expect(layout.lines).not.toContain('one');
  });

  it('keeps the newest rows of the reply and preserves the editor and queue', () => {
    const layout = liveLayout(frame({ live: 'one\ntwo\nthree\nfour', queue: 'queued', rows: 8 }));

    expect(layout.tail).toEqual(['three', 'four']);
    expect(layout.lines).toEqual(['queued', 'border', 'input', 'border']);
    expect(footerRows(layout).length).toBeLessThan(8);
  });

  it('counts the rows above the status line in the cursor row', () => {
    const layout = liveLayout(frame({ live: 'one\ntwo', queue: 'queued' }));
    const rows = footerRows(layout);

    expect(rows[layout.cursor?.y ?? 0]).toBe('input');
  });

  it('puts the cursor on the input row with a reply and an approval both showing', () => {
    const layout = liveLayout(frame({ live: 'one\ntwo', approval: 'command\nchoice', rows: 14 }));

    expect(layout.tail).toEqual(['one', 'two']);
    expect(footerRows(layout)[layout.cursor?.y ?? 0]).toBe('input');
  });

  it('does not keep any reply rows when there is no room for them', () => {
    const layout = liveLayout(frame({ live: 'one\ntwo', queue: 'queued', rows: 5 }));

    expect(layout.tail).toEqual([]);
    expect(layout.lines).toEqual(['border', 'input', 'border']);
  });

  it('blocks confirmation when the complete approval cannot fit', () => {
    const layout = liveLayout(frame({ approval: 'command\nconcerns\nchoice\nhint', rows: 8 }));

    expect(layout.approvalFits).toBe(false);
    expect(layout.lines.join('\n')).toContain('Enlarge terminal or Esc to skip');
    expect(footerRows(layout).length).toBeLessThan(8);
  });

  it('says why confirmation is blocked when the editor leaves the approval no row', () => {
    const layout = liveLayout(frame({ approval: 'command\nchoice', rows: 5 }));

    expect(layout.approvalFits).toBe(false);
    expect(layout.lines.join('\n')).toContain('Enlarge terminal or Esc to skip');
    expect(footerRows(layout).length).toBeLessThan(5);
  });

  it('never lets the reply displace a waiting approval or the editor', () => {
    const layout = liveLayout(
      frame({ live: 'one\ntwo\nthree', approval: 'command\nchoice', rows: 9 }),
    );

    expect(layout.approvalFits).toBe(true);
    expect(layout.lines.join('\n')).toContain('command\nchoice');
    expect(layout.lines.slice(-3)).toEqual(['border', 'input', 'border']);
    expect(footerRows(layout).length).toBeLessThan(9);
  });

  it('draws nothing above the status line when there is no unfinished reply', () => {
    expect(liveLayout(frame()).tail).toEqual([]);
  });

  it.each([2, 3, 4, 5, 6, 8, 10, 24])('bounds the footer at %i rows', (rows) => {
    const layout = liveLayout(
      frame({
        rows,
        live: 'large\n'.repeat(100),
        queue: 'queued',
        approval: 'long\n'.repeat(100),
      }),
    );

    expect(footerRows(layout).length).toBeLessThan(rows);
  });
});
