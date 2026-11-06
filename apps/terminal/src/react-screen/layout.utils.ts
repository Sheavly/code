import { CURSOR_MARKER, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { EditorFrame, LiveLayout, ReactScreenProps } from './react-screen.types.js';

/** Removes editor-private markers while retaining ANSI styling and the real input caret. */
export function editorFrame(lines: string[]): EditorFrame {
  let cursor: EditorFrame['cursor'];
  const clean = lines.map((line, y) => {
    const marker = line.indexOf(CURSOR_MARKER);

    if (marker >= 0) cursor = { x: visibleWidth(line.slice(0, marker)), y };

    return line
      .replaceAll(CURSOR_MARKER, '')
      .replaceAll('\u001b_pi:fc\u0007', '')
      .replaceAll('\u001b_pi:/fc\u0007', '');
  });

  return { lines: clean, cursor };
}

/** One physical row per static item avoids Ink's tall-item scrollback path. */
export function transcriptRows(params: { text: string; columns: number }): string[] {
  const { text, columns } = params;

  return wrapTextWithAnsi(text, Math.max(1, columns));
}

function rowsOf(params: { text: string; columns: number }): string[] {
  if (!params.text) return [];

  return transcriptRows(params);
}

/** Reserves a row outside Ink's live frame; an incomplete approval preview cannot be confirmed. */
export function liveLayout(props: ReactScreenProps): LiveLayout {
  const { columns, rows, editor } = props;
  const capacity = Math.max(0, rows - 2);
  const editorLines = editor.lines.slice(0, Math.min(editor.lines.length, capacity));
  const approval = rowsOf({ text: props.approval, columns });
  const available = Math.max(0, capacity - editorLines.length);
  const approvalFits = approval.length <= available;
  const beforeEditor = approval.slice(0, available);

  if (!approvalFits && beforeEditor.length > 0) {
    beforeEditor[beforeEditor.length - 1] =
      'Preview does not fit. Enlarge terminal or Esc to skip.'.slice(0, columns);
  }

  const remaining = Math.max(0, available - beforeEditor.length);
  const tail = rowsOf({ text: props.live, columns });
  const queue = rowsOf({ text: props.queue, columns }).slice(0, 1);
  const tailBudget = Math.max(0, remaining - queue.length);
  const context =
    remaining > 0
      ? [...(tailBudget > 0 ? tail.slice(-tailBudget) : []), ...queue].slice(-remaining)
      : [];
  const lines = [...context, ...beforeEditor, ...editorLines];
  const cursor =
    editor.cursor && editor.cursor.y < editorLines.length
      ? { x: editor.cursor.x, y: context.length + beforeEditor.length + editor.cursor.y + 1 }
      : undefined;

  return { lines, cursor, approvalFits };
}
