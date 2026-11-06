import type { Theme } from '../theme/theme.types.js';
import type { StatusInfo } from '../tui/tui.types.js';

export type TranscriptLine = { id: number; text: string };

/** What the working indicator draws: the status, in the theme's colours. */
export type ActivityProps = StatusInfo & { colors: Theme; reducedMotion?: boolean };

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
  /** The colours the working indicator takes. */
  colors: Theme;
  reducedMotion?: boolean;
  editor: EditorFrame;
  columns: number;
  rows: number;
};

export type LiveLayout = {
  lines: string[];
  cursor: { x: number; y: number } | undefined;
  approvalFits: boolean;
};
