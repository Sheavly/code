import type { StatusInfo } from '../tui/tui.types.js';

export type TranscriptLine = { id: number; text: string };

export type EditorFrame = {
  lines: string[];
  cursor: { x: number; y: number } | undefined;
};

export type ReactScreenProps = {
  history: TranscriptLine[];
  live: string;
  approval: string;
  queue: string;
  status: StatusInfo;
  editor: EditorFrame;
  columns: number;
  rows: number;
};

export type LiveLayout = {
  lines: string[];
  cursor: { x: number; y: number } | undefined;
  approvalFits: boolean;
};
