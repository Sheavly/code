import type { Editor, TuiInputListener } from '@earendil-works/pi-tui';
import type { StatusInfo } from './tui.types.js';

/** Rendering and input owned by a screen, independent of the chat's decisions. */
export type ChatView = {
  editor: Editor;
  /** The width in columns, read when a block of the reply is drawn. */
  readonly columns: number;
  start: () => void;
  stop: () => void;
  addInputListener: (listener: TuiInputListener) => void;
  requestRender: () => void;
  print: (line: string) => void;
  setLive: (text: string) => void;
  setApproval: (text: string) => void;
  setQueue: (text: string) => void;
  setStatus: (info: StatusInfo) => void;
  readonly canConfirm?: boolean;
};

export type EditorOptions = {
  commands: { name: string; description?: string }[];
  cwd: string;
};
