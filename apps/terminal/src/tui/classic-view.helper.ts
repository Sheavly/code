import { Container, Spacer, Text } from '@earendil-works/pi-tui';
import type { TUI } from '@earendil-works/pi-tui';
import { shellMarkSequence } from '../marks/marks.utils.js';
import { defaultPalette } from '../theme/palette.utils.js';
import type { ChatView, EditorOptions } from './chat-view.types.js';
import { createChatEditor } from './editor.helper.js';
import { statusText } from './view.utils.js';

/** The original main-screen renderer, kept as an explicit fallback. */
export function createClassicView(params: EditorOptions & { tui: TUI }): ChatView {
  const { tui, palette = defaultPalette } = params;
  const history = new Container();
  const live = new Text('', 0, 0);
  const approval = new Text('', 0, 0);
  const queue = new Text('', 0, 0);
  const status = new Text('', 0, 0);
  const editor = createChatEditor(params);

  for (const child of [history, live, approval, queue, status, editor]) {
    tui.addChild(child);
  }

  return {
    editor,
    palette,
    get columns() {
      return tui.terminal.columns;
    },
    start: () => tui.start(),
    stop: () => tui.stop(),
    addInputListener: (listener) => void tui.addInputListener(listener),
    requestRender: () => tui.requestRender(),
    print: (line, mark) => {
      if (mark === undefined && line.trim() === '') {
        history.addChild(new Spacer(1));

        return;
      }

      history.addChild(new Text(`${mark ? shellMarkSequence(mark) : ''}${line}`, 0, 0));
    },
    setLive: (text) => live.setText(text),
    setApproval: (text) => approval.setText(text),
    setQueue: (text) => queue.setText(text),
    setStatus: (info) => status.setText(statusText({ info, palette })),
  };
}
