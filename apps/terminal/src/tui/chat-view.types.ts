import type { Editor, TuiInputListener } from '@earendil-works/pi-tui';
import type { ShellMark } from '../marks/marks.types.js';
import type { Palette } from '../theme/theme.types.js';
import type { StatusInfo } from './tui.types.js';

/** Rendering and input owned by a screen, independent of the chat's decisions. */
export type ChatView = {
  editor: Editor;
  /** The width in columns, read when a block of the reply or a diff is drawn. */
  readonly columns: number;
  /** Whether the view strips styling (`NO_COLOR`), so a reply is drawn with its emphasis in text. */
  readonly plain?: boolean;
  /** The colours everything the screen draws in this view takes. */
  readonly palette: Palette;
  start: () => void;
  stop: () => void;
  addInputListener: (listener: TuiInputListener) => void;
  requestRender: () => void;
  /** Adds a row to the history; `mark` is put at its start, for a terminal that reads OSC 133. */
  print: (line: string, mark?: ShellMark) => void;
  setLive: (text: string) => void;
  setApproval: (text: string) => void;
  setQueue: (text: string) => void;
  setStatus: (info: StatusInfo) => void;
  readonly canConfirm?: boolean;
};

export type EditorOptions = {
  commands: { name: string; description?: string }[];
  cwd: string;
  /** The colours of the editor and its menus, and of what the view draws; the default theme's if none. */
  palette?: Palette;
};
