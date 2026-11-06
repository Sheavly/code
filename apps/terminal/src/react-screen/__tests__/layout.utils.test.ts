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
  it('keeps the newest live rows and preserves the editor and queue', () => {
    const layout = liveLayout(frame({ live: 'one\ntwo\nthree\nfour', queue: 'queued', rows: 8 }));

    expect(layout.lines).toEqual(['three', 'four', 'queued', 'border', 'input', 'border']);
    expect(layout.cursor).toEqual({ x: 0, y: 5 });
    expect(layout.lines.length + 1).toBeLessThan(8);
  });

  it('does not accidentally keep every tail row when the budget is zero', () => {
    const layout = liveLayout(frame({ live: 'one\ntwo', queue: 'queued', rows: 5 }));

    expect(layout.lines).toEqual(['border', 'input', 'border']);
  });

  it('blocks confirmation when the complete approval cannot fit', () => {
    const layout = liveLayout(frame({ approval: 'command\nconcerns\nchoice\nhint', rows: 8 }));

    expect(layout.approvalFits).toBe(false);
    expect(layout.lines.join('\n')).toContain('Enlarge terminal or Esc to skip');
    expect(layout.lines.length + 1).toBeLessThan(8);
  });

  it.each([2, 3, 4, 10, 24])('bounds the footer at %i rows', (rows) => {
    const layout = liveLayout(
      frame({ rows, live: 'large\n'.repeat(100), approval: 'long\n'.repeat(100) }),
    );

    expect(layout.lines.length + 1).toBeLessThan(rows);
  });
});
