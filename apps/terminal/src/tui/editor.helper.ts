import { CombinedAutocompleteProvider, Editor } from '@earendil-works/pi-tui';
import type { TUI } from '@earendil-works/pi-tui';
import { cyan, cyanBold, gray } from '../render/style.utils.js';
import type { EditorOptions } from './chat-view.types.js';

/** Keeps editing, history, completion and paste handling identical across renderers. */
export function createChatEditor(params: EditorOptions & { tui: TUI }): Editor {
  const { tui, commands, cwd } = params;
  const editor = new Editor(tui, {
    borderColor: gray,
    selectList: {
      selectedPrefix: cyan,
      selectedText: cyanBold,
      description: gray,
      scrollInfo: gray,
      noMatch: gray,
    },
  });

  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(commands, cwd));
  tui.setFocus(editor);

  return editor;
}
