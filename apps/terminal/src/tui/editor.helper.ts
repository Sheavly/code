import { CombinedAutocompleteProvider, Editor } from '@earendil-works/pi-tui';
import type { TUI } from '@earendil-works/pi-tui';
import { bold } from '../render/style.utils.js';
import { defaultPalette } from '../theme/palette.utils.js';
import type { EditorOptions } from './chat-view.types.js';

/** Keeps editing, history, completion and paste handling identical across renderers. */
export function createChatEditor(params: EditorOptions & { tui: TUI }): Editor {
  const { tui, commands, cwd, palette = defaultPalette } = params;
  const { secondary, accent } = palette.paint.text;
  const editor = new Editor(tui, {
    borderColor: secondary,
    selectList: {
      selectedPrefix: accent,
      selectedText: (text) => accent(bold(text)),
      description: secondary,
      scrollInfo: secondary,
      noMatch: secondary,
    },
  });

  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(commands, cwd));
  tui.setFocus(editor);

  return editor;
}
